/**
 * DI Mock Test Generator v2.5.0
 * 
 * This script generates Data Interpretation mock tests from reference PDF files using the Google Generative AI API.
 * It parses previous year questions (PYQs) and reference mocks to understand the desired format and style,
 * then generates new mock tests in JSON format and converts them into PowerPoint presentations.
 *
 * Key Correction:
 * - Fixed the instantiation of the GoogleGenAI client to match the official SDK documentation.
 *   Incorrect: new GoogleGenerativeAI(keyInfo.key)
 *   Correct:   new GoogleGenAI({ apiKey: keyInfo.key })
 * - This resolves the runtime errors related to incorrect class names and constructors.
 */

import { GoogleGenAI } from "@google/genai";
import { program } from "commander";
import * as fs from "fs/promises";
import * as path from "path";
import PptxGenJS from 'pptxgenjs';

// System prompt for the AI model to define its role and output format.
const SYSTEM_PROMPT_DI = `You are an expert Data Interpretation exam designer for competitive entrance exams. Your task is to generate a BRAND NEW mock test as a single, valid JSON object.

ANALYSIS REQUIREMENTS:
1. Study the provided "REFERENCE PYQ PDF" documents to understand question styles, topics, difficulty, and phrasing patterns
2. Examine the "REFERENCE Mock Test PDF" documents for structure and instruction tone
3. Follow user instructions exactly for question count, topics, difficulty, and format
4. Generate completely original content - DO NOT copy questions directly

OUTPUT REQUIREMENTS:
- Output ONLY a single JSON object with NO additional text or formatting
- Keep all strings under 200 characters to prevent truncation
- Use simple text formatting - avoid HTML tags or complex escaping
- Generate realistic, solvable questions with clear solutions

JSON STRUCTURE (use exactly this format):
{
  "title": "Data Interpretation Mock Test",
  "totalQuestions": 25,
  "timeMinutes": 60,
  "maxMarks": 100,
  "instructions": [
    "Read all data carefully before answering",
    "Each question carries equal marks",
    "Negative marking: -0.25 for wrong answers",
    "Use approximation where necessary"
  ],
  "questionSets": [
    {
      "setNumber": 1,
      "setTitle": "Sales Performance Analysis",
      "directions": "Study the following data and answer questions 1-5",
      "dataType": "table",
      "dataTitle": "Regional Sales Data (in Crores)",
      "tableHeaders": ["Region", "2021", "2022", "2023"],
      "tableRows": [
        ["North", "150", "180", "220"],
        ["South", "120", "140", "175"],
        ["East", "100", "115", "130"],
        ["West", "200", "240", "290"]
      ],
      "questions": [
        {
          "qNum": 1,
          "question": "What is the percentage increase in North region sales from 2021 to 2023?",
          "optA": "46.67%",
          "optB": "42.50%",
          "optC": "38.89%",
          "optD": "52.33%",
          "answer": "A",
          "explanation": "North increased from 150 to 220 crores. Calculation: ((220-150)/150) × 100 = 46.67%"
        }
      ]
    }
  ]
}

For chart data instead of table, use:
"dataType": "chart",
"chartType": "bar|pie|line|column",
"chartTitle": "Market Share Analysis",
"chartLabels": ["Q1", "Q2", "Q3", "Q4"],
"chartValues": [100, 150, 200, 175]

CONTENT GUIDELINES:
- Generate 5-6 question sets with 4-5 questions each (total 20-25 questions)
- Mix data types: tables, bar charts, pie charts, line graphs
- Use realistic business/survey/economic data scenarios
- Ensure all questions are solvable from the provided data
- Create meaningful distractors that test conceptual understanding
- Keep explanations clear and include calculations where relevant
- Maintain competitive exam difficulty and authentic question patterns

Generate the complete mock test now following this structure exactly.`;

// Chart type mapping for PptxGenJS
const CHART_TYPE_MAP = {
    'bar': 'bar',
    'column': 'column',
    'line': 'line',
    'pie': 'pie',
    'doughnut': 'doughnut',
    'area': 'area'
};

// Manages a pool of API keys to handle rate limiting and quota errors.
class ApiKeyManager {
    constructor(apiKeys) {
        this.apiKeys = apiKeys.filter(key => key && key.trim().length > 0);
        this.currentIndex = 0;
        this.failedKeys = new Set();
        this.keyUsageCount = new Map();
        if (this.apiKeys.length === 0) throw new Error("No valid API keys provided.");
        console.log(`Loaded ${this.apiKeys.length} API key(s).`);
    }

    getNextKey() {
        if (this.failedKeys.size === this.apiKeys.length) throw new Error("All API keys have failed.");
        let attempts = 0;
        let keyIndex = this.currentIndex;
        while (this.failedKeys.has(keyIndex) && attempts < this.apiKeys.length) {
            keyIndex = (keyIndex + 1) % this.apiKeys.length;
            attempts++;
        }
        if (this.failedKeys.has(keyIndex)) throw new Error("No available API keys remaining.");
        this.keyUsageCount.set(keyIndex, (this.keyUsageCount.get(keyIndex) || 0) + 1);
        this.currentIndex = (keyIndex + 1) % this.apiKeys.length;
        return { key: this.apiKeys[keyIndex], index: keyIndex };
    }

    markKeyFailed(keyIndex, error) {
        if (!this.failedKeys.has(keyIndex)) {
            this.failedKeys.add(keyIndex);
            console.warn(`API key ${keyIndex + 1} marked as failed: ${error.message}`);
        }
    }

    getStats() {
        return {
            total: this.apiKeys.length,
            available: this.apiKeys.length - this.failedKeys.size,
            failed: this.failedKeys.size,
            usage: Object.fromEntries(this.keyUsageCount)
        };
    }
}

// Recursively finds all PDF files in a given directory.
async function findPdfFiles(dirPath) {
    const pdfFiles = [];
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            pdfFiles.push(...await findPdfFiles(fullPath));
        } else if (path.extname(entry.name).toLowerCase() === '.pdf') {
            pdfFiles.push(fullPath);
        }
    }
    return pdfFiles;
}

// Reads PDF files and converts them to base64 format for the API.
async function processPdfFiles(filePaths, label) {
    const parts = [];
    for (const filePath of filePaths) {
        try {
            const data = await fs.readFile(filePath);
            parts.push({ inlineData: { mimeType: 'application/pdf', data: data.toString('base64') } });
            console.log(`Processed ${label}: ${path.basename(filePath)}`);
        } catch (error) {
            console.error(`Failed to process ${filePath}: ${error.message}`);
        }
    }
    return parts;
}

// Parses the JSON response from the API, cleaning it if necessary.
function parseJsonResponse(responseText) {
    let jsonString = responseText.trim();
    if (jsonString.startsWith('```json')) {
        jsonString = jsonString.substring(7, jsonString.length - 3).trim();
    } else if (jsonString.startsWith('```')) {
        jsonString = jsonString.substring(3, jsonString.length - 3).trim();
    }
    try {
        return JSON.parse(jsonString);
    } catch (error) {
        console.error("JSON parsing failed:", error.message);
        throw new Error(`Failed to parse JSON response: ${error.message}`);
    }
}

// Generates a PowerPoint presentation from the structured JSON data.
async function generatePowerPoint(examData, outputPath, backgroundPath = null) {
    console.log('Creating PowerPoint presentation...');
    const pptx = new PptxGenJS();
    
    const addSlideWithBg = (ppt) => {
        const slide = ppt.addSlide();
        if (backgroundPath) slide.background = { path: backgroundPath };
        return slide;
    };

    // Title Slide
    const titleSlide = addSlideWithBg(pptx);
    titleSlide.addText(examData.title || 'Data Interpretation Mock Test', { x: 0.5, y: 2.5, w: '90%', h: 1, fontSize: 36, bold: true, align: 'center' });

    // Instructions Slide
    const instSlide = addSlideWithBg(pptx);
    instSlide.addText('Instructions', { x: 0.5, y: 0.5, w: '90%', h: 1, fontSize: 28, bold: true, align: 'center' });
    if (examData.instructions) {
        instSlide.addText(examData.instructions.join('\n'), { x: 1, y: 1.5, w: '80%', h: 4, fontSize: 14, bullet: true });
    }
    
    for (const set of examData.questionSets || []) {
        // Data Slide
        const dataSlide = addSlideWithBg(pptx);
        dataSlide.addText(set.setTitle || `Set ${set.setNumber}`, { x: 0.5, y: 0.2, w: '90%', h: 0.5, fontSize: 24, bold: true, align: 'center' });
        
        if (set.dataType === 'table' && set.tableHeaders && set.tableRows) {
            dataSlide.addTable([set.tableHeaders, ...set.tableRows], { x: 0.5, y: 1.5, w: 9, border: { pt: 1 }, fill: "F7F7F7" });
            if (set.dataTitle) dataSlide.addText(set.dataTitle, { x: 0.5, y: 1.1, w: 9, align: 'center', bold: true, fontSize: 18 });
        } else if (set.dataType === 'chart' && set.chartType && set.chartLabels && set.chartValues) {
            const chartType = CHART_TYPE_MAP[set.chartType.toLowerCase()] || 'column';
            const data = [{ name: set.chartTitle || 'Series', labels: set.chartLabels, values: set.chartValues.map(v => Number(v) || 0) }];
            dataSlide.addChart(chartType, data, { x: 1, y: 1.5, w: 8, h: 4, showTitle: true, title: set.chartTitle });
        }
        
        // Question & Answer Slides
        for (const q of set.questions || []) {
            const qSlide = addSlideWithBg(pptx);
            qSlide.addText(`Q${q.qNum}: ${q.question}`, { x: 0.5, y: 0.5, w: '90%', h: 1, fontSize: 18, bold: true });
            const options = [ `A) ${q.optA}`, `B) ${q.optB}`, `C) ${q.optC}`, `D) ${q.optD}`];
            qSlide.addText(options.join('\n\n'), { x: 1, y: 1.5, w: '80%', h: 2.5, fontSize: 16 });
            qSlide.addText(`Answer: ${q.answer}\nExplanation: ${q.explanation || 'N/A'}`, { x: 0.5, y: 4.5, w: '90%', h: 2, fontSize: 14, color: '2a8c2a' });
        }
    }

    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await pptx.writeFile({ fileName: outputPath });
    console.log(`PowerPoint generated successfully: ${outputPath}`);
}

// Calls the Generative AI model to generate a mock test, with retry logic.
async function generateMockTest(contents, outputPath, mockNumber, totalMocks, apiKeyManager, options) {
    const maxRetries = 3;
    let lastError = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        let keyInfo;
        try {
            keyInfo = apiKeyManager.getNextKey();
            // FIXED: Correctly instantiate GoogleGenAI with the API key in a config object.
            const genAI = new GoogleGenAI({ apiKey: keyInfo.key });
            
            console.log(`Mock ${mockNumber}/${totalMocks} - Attempt ${attempt}/${maxRetries} (using API Key ${keyInfo.index + 1})`);
            
            const model = genAI.getGenerativeModel({ model: options.model });
            
            const generationConfig = {
                maxOutputTokens: options.maxTokens,
                temperature: options.temperature,
            };
            
            const result = await model.generateContent({ contents, generationConfig });
            
            const responseText = result.response.text();
            if (!responseText) throw new Error("Received an empty response from the API.");

            const examData = parseJsonResponse(responseText);
            await generatePowerPoint(examData, outputPath, options.pptBackground);
            
            console.log(`✅ Mock ${mockNumber}/${totalMocks} completed successfully.`);
            return { success: true, mockNumber, outputPath };

        } catch (error) {
            lastError = error;
            console.error(`❌ Mock ${mockNumber} - Attempt ${attempt} failed: ${error.message}`);
            
            const isQuotaError = error.message.toLowerCase().includes('quota') || error.message.toLowerCase().includes('resource_exhausted');
            if (keyInfo && isQuotaError) {
                apiKeyManager.markKeyFailed(keyInfo.index, error);
            }
            
            if (attempt < maxRetries) {
                const delay = 1000 * Math.pow(2, attempt - 1);
                console.log(`Retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    
    return { success: false, error: lastError, mockNumber };
}

// Main function to parse command-line arguments and orchestrate the generation process.
async function main() {
    program
        .name('di-mock-generator')
        .description('Generate Data Interpretation mock tests from PDFs using Gemini.')
        .version('2.5.0')
        .requiredOption('--pyq <directory>', 'Directory for Previous Year Question PDFs')
        .requiredOption('--reference-mock <directory>', 'Directory for reference mock test PDFs')
        .requiredOption('-o, --output <filename>', 'Output filename (.pptx) or base name')
        .requiredOption('--prompt <file>', 'Path to the user prompt text file')
        .option('--api-key-file <file>', 'File with API keys (one per line)', 'api_key.txt')
        .option('--number-of-mocks <number>', 'Number of mock tests to generate', v => parseInt(v, 10), 1)
        .option('--model <model>', 'Gemini model name', 'gemini-1.5-flash')
        .option('--max-tokens <number>', 'Max output tokens', v => parseInt(v, 10), 8192)
        .option('--temperature <number>', 'Generation temperature (0.0-1.0)', v => parseFloat(v), 0.7)
        .option('--ppt-background <file>', 'Optional background image for PowerPoint slides')
        .option('--delay <number>', 'Delay between generating mocks (ms)', v => parseInt(v, 10), 2000)
        .parse(process.argv);

    const options = program.opts();

    try {
        console.log('DI Mock Test Generator v2.5.0');
        console.log('============================================');
        
        const apiKeys = (await fs.readFile(options.apiKeyFile, 'utf-8')).split('\n').map(k => k.trim()).filter(Boolean);
        const apiKeyManager = new ApiKeyManager(apiKeys);

        const userPrompt = await fs.readFile(options.prompt, 'utf-8');
        if (!userPrompt.trim()) throw new Error("Prompt file is empty.");

        const pyqFiles = await findPdfFiles(options.pyq);
        const refMockFiles = await findPdfFiles(options.referenceMock);
        if (pyqFiles.length === 0 || refMockFiles.length === 0) {
            throw new Error("Reference PDF directories must not be empty.");
        }
        
        const fileParts = [
            ...(await processPdfFiles(pyqFiles, 'PYQ PDF')),
            ...(await processPdfFiles(refMockFiles, 'Mock Test PDF'))
        ];
        
        const contents = [{ text: SYSTEM_PROMPT_DI }, { text: userPrompt }, ...fileParts];
        
        console.log(`\nStarting generation of ${options.numberOfMocks} mock test(s)...`);
        console.log('----------------------------------------------------');

        const results = [];
        for (let i = 1; i <= options.numberOfMocks; i++) {
            const outputFileName = options.numberOfMocks > 1
                ? options.output.replace(/(\.pptx)?$/, `-${i}.pptx`)
                : options.output;
            
            results.push(await generateMockTest(contents, outputFileName, i, options.numberOfMocks, apiKeyManager, options));
            
            if (i < options.numberOfMocks && options.delay > 0) {
                console.log(`Waiting ${options.delay}ms before next request...`);
                await new Promise(resolve => setTimeout(resolve, options.delay));
            }
        }
        
        console.log('\n============================================');
        console.log('         Generation Summary');
        console.log('============================================');
        const successCount = results.filter(r => r.success).length;
        console.log(`Total mocks requested: ${options.numberOfMocks}`);
        console.log(`  Successfully generated: ${successCount}`);
        console.log(`  Failed: ${options.numberOfMocks - successCount}`);
        
        results.filter(r => !r.success).forEach(r => console.log(`  - Mock ${r.mockNumber} failed: ${r.error.message}`));
        
        console.log('\nAPI Key Usage Stats:');
        console.dir(apiKeyManager.getStats());
        console.log('\nGeneration process finished.');
        
    } catch (error) {
        console.error(`\n[FATAL ERROR] Operation failed: ${error.message}`);
        process.exitCode = 1;
    }
}

main();
