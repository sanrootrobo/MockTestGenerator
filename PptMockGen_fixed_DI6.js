import { GoogleGenAI } from "@google/genai";
import { program } from "commander";
import * as fs from "fs/promises";
import * as path from "path";
import PptxGenJS from 'pptxgenjs';

// Simplified system prompt for DI exam generation
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
    'bar': 'column',
    'column': 'column',
    'line': 'line',
    'pie': 'pie',
    'doughnut': 'doughnut',
    'area': 'area'
};

// Enhanced API Key Manager
class ApiKeyManager {
    constructor(apiKeys) {
        this.apiKeys = apiKeys.filter(key => key && key.trim().length > 0);
        this.currentIndex = 0;
        this.failedKeys = new Set();
        this.keyUsageCount = new Map();
        
        if (this.apiKeys.length === 0) {
            throw new Error("No valid API keys provided");
        }
        
        console.log(`Loaded ${this.apiKeys.length} API key(s)`);
    }

    getNextKey() {
        if (this.failedKeys.size === this.apiKeys.length) {
            throw new Error("All API keys have failed or reached quota");
        }
        
        let attempts = 0;
        while (this.failedKeys.has(this.currentIndex) && attempts < this.apiKeys.length) {
            this.currentIndex = (this.currentIndex + 1) % this.apiKeys.length;
            attempts++;
        }
        
        if (this.failedKeys.has(this.currentIndex)) {
            throw new Error("No available API keys remaining");
        }
        
        const keyIndex = this.currentIndex;
        const key = this.apiKeys[keyIndex];
        
        // Track usage
        this.keyUsageCount.set(keyIndex, (this.keyUsageCount.get(keyIndex) || 0) + 1);
        
        // Rotate to next key for load balancing
        this.currentIndex = (this.currentIndex + 1) % this.apiKeys.length;
        
        return { key, index: keyIndex };
    }

    markKeyFailed(keyIndex, error) {
        this.failedKeys.add(keyIndex);
        console.warn(`API key ${keyIndex + 1} marked as failed: ${error.message}`);
    }

    getStats() {
        const available = this.apiKeys.length - this.failedKeys.size;
        return {
            total: this.apiKeys.length,
            available,
            failed: this.failedKeys.size,
            usage: Object.fromEntries(this.keyUsageCount)
        };
    }
}

// Enhanced file utilities
async function findPdfFiles(dirPath) {
    const pdfFiles = [];
    
    try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        
        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);
            
            if (entry.isDirectory()) {
                const subFiles = await findPdfFiles(fullPath);
                pdfFiles.push(...subFiles);
            } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.pdf') {
                pdfFiles.push(fullPath);
            }
        }
    } catch (error) {
        throw new Error(`Failed to read directory '${dirPath}': ${error.message}`);
    }
    
    return pdfFiles;
}

async function processPdfFiles(filePaths, label) {
    const parts = [];
    const maxFileSize = 20 * 1024 * 1024; // 20MB limit
    let totalSize = 0;
    let processedCount = 0;
    
    for (const filePath of filePaths) {
        try {
            const stats = await fs.stat(filePath);
            
            if (stats.size > maxFileSize) {
                console.warn(`Skipping ${path.basename(filePath)} (${(stats.size / 1024 / 1024).toFixed(1)}MB > 20MB limit)`);
                continue;
            }
            
            console.log(`Processing ${label}: ${path.basename(filePath)} (${(stats.size / 1024 / 1024).toFixed(1)}MB)`);
            
            const fileBuffer = await fs.readFile(filePath);
            parts.push({
                inlineData: {
                    mimeType: 'application/pdf',
                    data: fileBuffer.toString('base64'),
                },
            });
            
            totalSize += stats.size;
            processedCount++;
            
        } catch (error) {
            console.error(`Failed to process ${filePath}: ${error.message}`);
        }
    }
    
    console.log(`Processed ${processedCount}/${filePaths.length} ${label} files (${(totalSize / 1024 / 1024).toFixed(1)}MB total)`);
    return parts;
}

// Simplified JSON parsing function
function parseJsonResponse(responseText) {
    if (!responseText || typeof responseText !== 'string') {
        throw new Error("Empty response from API");
    }

    // Basic cleanup
    let json = responseText.trim();
    
    // Remove markdown code blocks
    if (json.startsWith('```')) {
        json = json.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '');
    }
    
    // Remove common problematic characters
    json = json
        .replace(/[\u0000-\u001F\u007F]/g, '') // Control characters
        .replace(/,(\s*[}\]])/g, '$1') // Trailing commas
        .replace(/\n/g, ' ') // Newlines to spaces
        .replace(/\s+/g, ' '); // Multiple spaces to single

    try {
        const data = JSON.parse(json);
        
        // Basic validation
        if (!data || typeof data !== 'object') {
            throw new Error("Response is not a valid JSON object");
        }
        
        if (!Array.isArray(data.questionSets)) {
            throw new Error("Missing questionSets array");
        }
        
        if (data.questionSets.length === 0) {
            throw new Error("No question sets found");
        }
        
        // Count questions
        let totalQuestions = 0;
        for (const set of data.questionSets) {
            if (Array.isArray(set.questions)) {
                totalQuestions += set.questions.length;
            }
        }
        
        if (totalQuestions === 0) {
            throw new Error("No questions found in any set");
        }
        
        console.log(`JSON parsed: ${totalQuestions} questions in ${data.questionSets.length} sets`);
        return data;
        
    } catch (error) {
        console.error("JSON parsing failed:", error.message);
        console.error("Response preview:", json.substring(0, 500));
        
        // Attempt basic recovery
        const recovered = attemptJsonRecovery(json);
        if (recovered) {
            console.log("Attempting JSON recovery...");
            try {
                const recoveredData = JSON.parse(recovered);
                console.log("Recovery successful");
                return recoveredData;
            } catch (recoveryError) {
                console.error("Recovery failed:", recoveryError.message);
            }
        }
        
        throw new Error(`JSON parsing failed: ${error.message}`);
    }
}

function attemptJsonRecovery(jsonString) {
    try {
        // Find the main object boundaries
        const start = jsonString.indexOf('{');
        const lastBrace = jsonString.lastIndexOf('}');
        
        if (start === -1 || lastBrace === -1 || start >= lastBrace) {
            return null;
        }
        
        // Extract the main JSON object
        let extracted = jsonString.substring(start, lastBrace + 1);
        
        // Try to balance braces
        const openBraces = (extracted.match(/{/g) || []).length;
        const closeBraces = (extracted.match(/}/g) || []).length;
        
        if (openBraces > closeBraces) {
            extracted += '}'.repeat(openBraces - closeBraces);
        }
        
        // Try to balance brackets
        const openBrackets = (extracted.match(/\[/g) || []).length;
        const closeBrackets = (extracted.match(/\]/g) || []).length;
        
        if (openBrackets > closeBrackets) {
            extracted += ']'.repeat(openBrackets - closeBrackets);
        }
        
        return extracted;
        
    } catch (error) {
        return null;
    }
}

// PowerPoint generation utilities
function addSlideWithBackground(pptx, backgroundPath) {
    const slide = pptx.addSlide();
    if (backgroundPath) {
        try {
            slide.background = { path: backgroundPath };
        } catch (error) {
            console.warn(`Failed to set background image: ${error.message}`);
        }
    }
    return slide;
}

// Defensive PowerPoint generation utilities
function createChart(slide, chartData, position = {}) {
    // Comprehensive null/undefined checks
    if (!chartData) {
        console.warn("Skipping chart: chartData is null/undefined");
        return false;
    }

    if (!chartData.chartLabels || !Array.isArray(chartData.chartLabels) || chartData.chartLabels.length === 0) {
        console.warn("Skipping chart: Missing or empty chartLabels array");
        return false;
    }

    if (!chartData.chartValues || !Array.isArray(chartData.chartValues) || chartData.chartValues.length === 0) {
        console.warn("Skipping chart: Missing or empty chartValues array");
        return false;
    }

    if (chartData.chartLabels.length !== chartData.chartValues.length) {
        console.warn("Skipping chart: Labels and values arrays have different lengths");
        return false;
    }

    const pos = { x: 1, y: 2, w: 8, h: 4, ...position };

    try {
        let chartDataArray = [];
        const pptxChartType = CHART_TYPE_MAP[chartData.chartType] || 'column';

        if (chartData.chartType === 'pie' || chartData.chartType === 'doughnut') {
            // Pie chart format
            chartDataArray = chartData.chartLabels.map((label, index) => ({
                name: String(label || `Item ${index + 1}`),
                value: Number(chartData.chartValues[index]) || 0
            }));
        } else {
            // Bar/Line/Column chart format
            chartDataArray = chartData.chartLabels.map((label, index) => ({
                name: String(label || `Item ${index + 1}`),
                value: Number(chartData.chartValues[index]) || 0
            }));
        }

        if (chartDataArray.length === 0) {
            console.warn("No valid chart data points generated");
            return false;
        }

        const chartConfig = {
            x: pos.x,
            y: pos.y,
            w: pos.w,
            h: pos.h,
            showTitle: Boolean(chartData.chartTitle),
            title: chartData.chartTitle || '',
            showLegend: true,
            showValue: true,
            ...((chartData.chartType === 'doughnut') && { hole: 0.4 })
        };

        slide.addChart(pptxChartType, chartDataArray, chartConfig);
        console.log(`Created ${chartData.chartType} chart with ${chartDataArray.length} data points`);
        return true;
        
    } catch (error) {
        console.error(`Error creating ${chartData.chartType || 'unknown'} chart: ${error.message}`);
        return false;
    }
}

function createTable(slide, tableData, position = {}) {
    // Comprehensive null/undefined checks
    if (!tableData) {
        console.warn("Skipping table: tableData is null/undefined");
        return false;
    }

    if (!tableData.tableHeaders || !Array.isArray(tableData.tableHeaders) || tableData.tableHeaders.length === 0) {
        console.warn("Skipping table: Missing or empty tableHeaders array");
        return false;
    }

    if (!tableData.tableRows || !Array.isArray(tableData.tableRows) || tableData.tableRows.length === 0) {
        console.warn("Skipping table: Missing or empty tableRows array");
        return false;
    }

    const pos = { x: 0.5, y: 2, w: 9, h: 4, ...position };

    try {
        // Prepare table data with defensive checks
        const tableRows = [
            // Headers row
            tableData.tableHeaders.map(header => String(header || '')),
            // Data rows with extra safety
            ...tableData.tableRows.map(row => {
                if (!row) return [''];
                if (Array.isArray(row)) {
                    return row.map(cell => String(cell || ''));
                } else {
                    return [String(row)];
                }
            })
        ];

        if (tableRows.length <= 1) {
            console.warn("Table has no data rows after processing");
            return false;
        }

        const tableConfig = {
            x: pos.x,
            y: pos.y,
            w: pos.w,
            h: pos.h,
            border: { type: "solid", pt: 1, color: "1A365D" },
            fill: { color: "F8FAFC" },
            color: "1E293B",
            fontSize: 11,
            align: "center",
            valign: "middle"
        };

        slide.addTable(tableRows, tableConfig);

        // Add title if provided
        if (tableData.dataTitle && typeof tableData.dataTitle === 'string' && tableData.dataTitle.trim()) {
            slide.addText(tableData.dataTitle.trim(), {
                x: pos.x,
                y: pos.y - 0.4,
                w: pos.w,
                h: 0.3,
                fontSize: 14,
                bold: true,
                color: "1A365D",
                align: "center"
            });
        }

        console.log(`Created table with ${tableRows.length - 1} data rows and ${tableData.tableHeaders.length} columns`);
        return true;
        
    } catch (error) {
        console.error(`Error creating table: ${error.message}`);
        return false;
    }
}

// Defensive PowerPoint generation
async function generatePowerPoint(examData, outputPath, backgroundPath = null) {
    try {
        console.log('Creating PowerPoint presentation...');
        
        // Validate examData
        if (!examData || typeof examData !== 'object') {
            throw new Error("examData is null, undefined, or not an object");
        }

        const pptx = new PptxGenJS();
        
        // Title slide
        const titleSlide = addSlideWithBackground(pptx, backgroundPath);
        titleSlide.addText(examData.title || 'Data Interpretation Mock Test', {
            x: 0.5, y: 2, w: '90%', h: 1,
            fontSize: 32, bold: true, color: '003B75', align: 'center'
        });
        
        const detailsText = [
            examData.totalQuestions && `Questions: ${examData.totalQuestions}`,
            examData.timeMinutes && `Time: ${examData.timeMinutes} minutes`,
            examData.maxMarks && `Marks: ${examData.maxMarks}`
        ].filter(Boolean).join(' | ');
        
        if (detailsText) {
            titleSlide.addText(detailsText, {
                x: 0.5, y: 3.2, w: '90%', h: 0.5,
                fontSize: 16, color: '4A5568', align: 'center'
            });
        }
        
        // Instructions slide
        const instSlide = addSlideWithBackground(pptx, backgroundPath);
        instSlide.addText('Instructions', {
            x: 0.5, y: 0.7, w: '90%', h: 0.6,
            fontSize: 24, bold: true, color: '2B6CB0', align: 'center'
        });
        
        let currentY = 1.5;
        const instructions = examData.instructions || [];
        
        if (Array.isArray(instructions) && instructions.length > 0) {
            instructions.forEach(instruction => {
                if (instruction && typeof instruction === 'string') {
                    instSlide.addText(`• ${instruction}`, {
                        x: 1, y: currentY, w: '85%', h: 0.4,
                        fontSize: 14, color: '2D3748'
                    });
                    currentY += 0.5;
                }
            });
        }
        
        // Process question sets with defensive checks
        const questionSets = examData.questionSets || [];
        let totalSets = 0;
        
        if (!Array.isArray(questionSets)) {
            console.warn("questionSets is not an array, skipping question processing");
        } else {
            for (const questionSet of questionSets) {
                if (!questionSet || typeof questionSet !== 'object') {
                    console.warn("Skipping invalid question set");
                    continue;
                }

                totalSets++;
                console.log(`Processing question set ${totalSets}`);
                
                // Data slide
                const dataSlide = addSlideWithBackground(pptx, backgroundPath);
                dataSlide.addText(questionSet.setTitle || `Set ${questionSet.setNumber || totalSets}`, {
                    x: 0.5, y: 0.3, w: '90%', h: 0.5,
                    fontSize: 20, bold: true, color: '1A365D', align: 'center'
                });
                
                if (questionSet.directions && typeof questionSet.directions === 'string') {
                    dataSlide.addText(questionSet.directions, {
                        x: 0.5, y: 0.9, w: '90%', h: 0.4,
                        fontSize: 12, color: '4A5568', align: 'center'
                    });
                }
                
                // Add chart or table with error handling
                let hasData = false;
                if (questionSet.dataType === 'chart') {
                    hasData = createChart(dataSlide, questionSet, { x: 1, y: 1.5, w: 8, h: 4 });
                } else if (questionSet.dataType === 'table') {
                    hasData = createTable(dataSlide, questionSet, { x: 0.5, y: 1.5, w: 9, h: 4 });
                }
                
                if (!hasData) {
                    dataSlide.addText('Data visualization not available', {
                        x: 0.5, y: 3, w: '90%', h: 0.5,
                        fontSize: 14, color: 'CC0000', align: 'center', italic: true
                    });
                }
                
                // Questions slide
                const qSlide = addSlideWithBackground(pptx, backgroundPath);
                qSlide.addText(`Questions - Set ${questionSet.setNumber || totalSets}`, {
                    x: 0.5, y: 0.3, w: '90%', h: 0.4,
                    fontSize: 18, bold: true, color: '1A365D', align: 'center'
                });
                
                let qY = 1;
                const questions = questionSet.questions || [];
                
                if (Array.isArray(questions)) {
                    questions.slice(0, 4).forEach(q => { // Limit to 4 questions per slide
                        if (!q || typeof q !== 'object' || qY > 6.5) return;
                        
                        if (q.question && typeof q.question === 'string') {
                            qSlide.addText(`Q${q.qNum || '?'}. ${q.question}`, {
                                x: 0.5, y: qY, w: '90%', h: 0.3,
                                fontSize: 11, bold: true, color: '2D3748'
                            });
                            qY += 0.3;
                            
                            ['A', 'B', 'C', 'D'].forEach(opt => {
                                const optionText = q[`opt${opt}`];
                                if (optionText && typeof optionText === 'string' && qY <= 7) {
                                    qSlide.addText(`${opt}) ${optionText}`, {
                                        x: 0.8, y: qY, w: '80%', h: 0.2,
                                        fontSize: 9, color: '4A5568'
                                    });
                                    qY += 0.25;
                                }
                            });
                            qY += 0.15;
                        }
                    });
                }
            }
        }

        // Add separator for answers
        const separatorSlide = addSlideWithBackground(pptx, backgroundPath);
        separatorSlide.addText('Answers & Solutions', {
            x: 0, y: '45%', w: '100%', h: 1,
            align: 'center', fontSize: 32, color: '003B75', bold: true
        });

        // Answer slides with defensive checks
        if (Array.isArray(questionSets)) {
            for (const questionSet of questionSets) {
                if (!questionSet || typeof questionSet !== 'object') continue;

                const ansSlide = addSlideWithBackground(pptx, backgroundPath);
                ansSlide.addText(`Answers - Set ${questionSet.setNumber || '?'}`, {
                    x: 0.5, y: 0.3, w: '90%', h: 0.4,
                    fontSize: 18, bold: true, color: '1A365D', align: 'center'
                });
                
                let aY = 1;
                const questions = questionSet.questions || [];
                
                if (Array.isArray(questions)) {
                    questions.forEach(q => {
                        if (!q || typeof q !== 'object' || aY > 6.5) return;
                        
                        if (q.qNum && q.answer) {
                            ansSlide.addText(`Q${q.qNum}: ${q.answer}`, {
                                x: 0.5, y: aY, w: '90%', h: 0.25,
                                fontSize: 12, bold: true, color: '38A169'
                            });
                            aY += 0.3;
                            
                            if (q.explanation && typeof q.explanation === 'string') {
                                ansSlide.addText(q.explanation, {
                                    x: 0.5, y: aY, w: '90%', h: 0.5,
                                    fontSize: 10, color: '2F855A'
                                });
                                aY += 0.6;
                            }
                        }
                    });
                }
            }
        }

        // Ensure output directory exists
        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        
        // Save presentation
        console.log('Saving PowerPoint file...');
        await pptx.writeFile({ fileName: outputPath });
        console.log(`PowerPoint generated: ${path.basename(outputPath)} (${totalSets} sets)`);
        
        return { success: true, outputPath, totalSets };
        
    } catch (error) {
        console.error(`PowerPoint generation failed: ${error.message}`);
        console.error('Stack trace:', error.stack);
        throw error;
    }
}



// Mock test generation with retry logic - FIXED VERSION
// Mock test generation with retry logic - CORRECTED VERSION
// Mock test generation with retry logic - FULLY CORRECTED VERSION

// Mock test generation with retry logic - FULLY CORRECTED VERSION
async function generateMockTest(contents, outputPath, mockNumber, totalMocks, apiKeyManager, options = {}) {
    const maxRetries = 3;
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        let keyInfo;
        try {
            keyInfo = apiKeyManager.getNextKey();
            
            // CORRECTED: Exactly as per your working example
            const ai = new GoogleGenAI({ apiKey: keyInfo.key });

            console.log(`Mock ${mockNumber}/${totalMocks} - Attempt ${attempt}/${maxRetries} (API Key ${keyInfo.index + 1})`);

            // CORRECTED: Exactly matching your working example structure
            const response = await ai.models.generateContent({
                model: options.model || "gemini-2.0-flash",
                contents: contents,
                generationConfig: {
                    maxOutputTokens: options.maxTokens || 8192,
                    temperature: options.temperature || 0.7,
                    topP: options.topP || 0.9,
                    topK: options.topK || 40
                }
            });

            // CORRECTED: Exactly as per your example
            const responseText = response.text;
            
            if (!responseText) {
                throw new Error("Received an empty response from the API.");
            }

            console.log(`Response received: ${responseText.length} characters`);

            const examData = parseJsonResponse(responseText);
            const pptResult = await generatePowerPoint(examData, outputPath, options.pptBackground);

            console.log(`Mock ${mockNumber}/${totalMocks} completed successfully.`);
            return { success: true, outputPath, mockNumber, examData, pptResult };

        } catch (error) {
            lastError = error;
            const isQuotaError = error.message.toLowerCase().includes('quota') ||
                               error.message.toLowerCase().includes('resource_exhausted') ||
                               error.message.toLowerCase().includes('rate limit') ||
                               error.message.toLowerCase().includes('429') ||
                               error.status === 429;

            if (keyInfo && isQuotaError) {
                apiKeyManager.markKeyFailed(keyInfo.index, error);
            }

            console.error(`Mock ${mockNumber} - Attempt ${attempt} failed: ${error.message}`);

            if (attempt < maxRetries) {
                const delay = 1000 * Math.pow(2, attempt - 1);
                console.log(`Retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    // If all retries fail
    return { success: false, error: lastError, outputPath, mockNumber };
}

// Main application logic
async function main() {
    program
        .name('di-mock-generator')
        .description('Generate Data Interpretation mock tests from PDFs')
        .version('2.2.1')
        .requiredOption('--pyq <directory>', 'Directory containing PYQ PDF files')
        .requiredOption('--reference-mock <directory>', 'Directory containing reference mock PDF files')
        .requiredOption('-o, --output <filename>', 'Output filename (.pptx) or base name for multiple mocks')
        .requiredOption('--prompt <file>', 'User prompt/instructions file')
        .option('--api-key-file <file>', 'File containing API keys (one per line)', 'api_key.txt')
        .option('--number-of-mocks <number>', 'Number of mock tests to generate', (v) => parseInt(v, 10), 1)
        .option('--model <model>', 'Gemini model to use', 'gemini-2.5-flash')
        .option('--max-tokens <number>', 'Maximum output tokens', (v) => parseInt(v, 10), 8192)
        .option('--temperature <number>', 'Temperature for generation', (v) => parseFloat(v), 0.7)
        .option('--ppt-background <file>', 'Background image for PowerPoint slides')
        .option('--delay <number>', 'Delay between generating mocks (ms)', (v) => parseInt(v, 10), 1000)
        .parse(process.argv);

    const options = program.opts();

    try {
        console.log('DI Mock Test Generator v2.2.1');
        console.log('============================================');

        // Validate directories and files
        for (const path of [options.pyq, options.referenceMock, options.prompt, options.apiKeyFile]) {
            await fs.access(path);
        }

        // Load API keys
        const apiKeyContent = await fs.readFile(options.apiKeyFile, 'utf-8');
        const apiKeys = apiKeyContent.split('\n').map(k => k.trim()).filter(Boolean);
        const apiKeyManager = new ApiKeyManager(apiKeys);

        // Load user prompt
        const userPrompt = await fs.readFile(options.prompt, 'utf-8');
        if (!userPrompt.trim()) throw new Error("Prompt file is empty");

        // Process PDF files
        console.log('Processing reference PDF files...');
        const pyqFiles = await findPdfFiles(options.pyq);
        const refMockFiles = await findPdfFiles(options.referenceMock);

        if (pyqFiles.length === 0) throw new Error(`No PDF files found in PYQ directory: ${options.pyq}`);
        if (refMockFiles.length === 0) throw new Error(`No PDF files found in reference mock directory: ${options.referenceMock}`);

        const fileParts = [
            ...(await processPdfFiles(pyqFiles, 'REFERENCE PYQ PDF')),
            ...(await processPdfFiles(refMockFiles, 'REFERENCE Mock Test PDF'))
        ];

        // Construct the full prompt for the model
        const contents = [{ text: SYSTEM_PROMPT_DI }, { text: userPrompt }, ...fileParts];

        console.log(`\nStarting generation of ${options.numberOfMocks} mock test(s)...`);
        console.log('----------------------------------------------------');

        const results = [];
        for (let i = 1; i <= options.numberOfMocks; i++) {
            const outputFileName = options.numberOfMocks > 1
                ? options.output.replace(/(\.pptx)?$/, `-${i}.pptx`)
                : options.output;

            const result = await generateMockTest(contents, outputFileName, i, options.numberOfMocks, apiKeyManager, options);
            results.push(result);

            if (i < options.numberOfMocks && options.delay > 0) {
                console.log(`Waiting ${options.delay}ms before next request...`);
                await new Promise(resolve => setTimeout(resolve, options.delay));
            }
        }

        // Final summary
        console.log('\n============================================');
        console.log('         Generation Summary');
        console.log('============================================');
        const successCount = results.filter(r => r.success).length;
        console.log(`Total mocks requested: ${options.numberOfMocks}`);
        console.log(`  Successfully generated: ${successCount}`);
        console.log(`  Failed: ${options.numberOfMocks - successCount}`);
	            if (successCount < options.numberOfMocks) {
            console.log('\nFailed mocks:');
            results.forEach((r, idx) => {
                if (!r.success) {
                    console.log(`  Mock ${idx + 1}: ${r.error ? r.error.message : 'Unknown error'}`);
                }
            });
        }

        // API key usage stats
        console.log('\nAPI Key Usage Statistics:');
        console.log(apiKeyManager.getStats());

        console.log('\nGeneration completed.');
        process.exit(successCount === options.numberOfMocks ? 0 : 1);

    } catch (error) {
        console.error(`Fatal error: ${error.message}`);
        process.exit(1);
    }
}

// Entry point
main();

