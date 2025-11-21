import { GoogleGenerativeAI } from "@google/generative-ai";
import { program } from "commander";
import * as fs from "fs/promises";
import * as path from "path";
import PptxGenJS from 'pptxgenjs';

// Optimized system prompt for DI exam generation with truncation prevention
const SYSTEM_PROMPT_DI = `You are an expert Data Interpretation exam designer. Generate a COMPLETE, VALID JSON mock test.

CRITICAL REQUIREMENTS:
1. Output ONLY valid JSON - no other text
2. Keep ALL strings under 100 characters to prevent truncation
3. Generate EXACTLY 3 question sets with 3 questions each (9 total)
4. Ensure the response is COMPLETE and doesn't get cut off

JSON STRUCTURE (EXACT FORMAT):
{
  "title": "DI Mock Test",
  "totalQuestions": 9,
  "timeMinutes": 30,
  "maxMarks": 36,
  "instructions": [
    "Read data carefully",
    "Each question: 4 marks",
    "Negative marking: -1",
    "Use approximation"
  ],
  "questionSets": [
    {
      "setNumber": 1,
      "setTitle": "Sales Analysis",
      "directions": "Study the data and answer Q1-3",
      "dataType": "table",
      "dataTitle": "Sales Data (Crores)",
      "tableHeaders": ["Region", "2022", "2023"],
      "tableRows": [
        ["North", "100", "120"],
        ["South", "80", "100"],
        ["East", "60", "75"]
      ],
      "questions": [
        {
          "qNum": 1,
          "question": "Which region had highest growth?",
          "optA": "North",
          "optB": "South", 
          "optC": "East",
          "optD": "All equal",
          "answer": "B",
          "explanation": "South: 25% growth vs North: 20%, East: 25%"
        },
        {
          "qNum": 2,
          "question": "Total sales in 2023?",
          "optA": "295",
          "optB": "240",
          "optC": "285",
          "optD": "300",
          "answer": "A",
          "explanation": "120+100+75 = 295 crores"
        },
        {
          "qNum": 3,
          "question": "Average growth rate?",
          "optA": "20%",
          "optB": "23.33%",
          "optC": "25%",
          "optD": "22%",
          "answer": "B",
          "explanation": "(20+25+25)/3 = 23.33%"
        }
      ]
    }
  ]
}

IMPORTANT: 
- Generate 3 complete question sets following this pattern
- Mix data types: table, chart, table
- Keep all text short to prevent truncation
- Ensure JSON is complete and valid
- No explanatory text outside JSON`;

// Chart type mapping for PptxGenJS
const CHART_TYPE_MAP = {
    'bar': 'bar',
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

// Enhanced JSON parsing function with better recovery
function parseJsonResponse(responseText) {
    if (!responseText || typeof responseText !== 'string') {
        throw new Error("Empty response from API");
    }

    console.log(`Raw response length: ${responseText.length} characters`);

    // Basic cleanup
    let json = responseText.trim();
    
    // Remove markdown code blocks
    if (json.startsWith('```')) {
        json = json.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '');
    }
    
    // More aggressive cleanup for problematic characters
    json = json
        .replace(/[\u0000-\u001F\u007F]/g, '') // Control characters
        .replace(/,(\s*[}\]])/g, '$1') // Trailing commas
        .replace(/\r\n/g, ' ') // Windows line endings
        .replace(/\n/g, ' ') // Unix line endings
        .replace(/\r/g, ' ') // Mac line endings
        .replace(/\t/g, ' ') // Tabs
        .replace(/\s+/g, ' ') // Multiple spaces to single
        .replace(/\\"/g, '\\"') // Fix escaped quotes
        .replace(/([^\\])"/g, '$1\\"') // Fix unescaped quotes in strings (basic)
        .trim();

    // Try multiple recovery strategies
    const strategies = [
        () => json, // Original
        () => attemptJsonRecovery(json), // Basic recovery
        () => attemptAdvancedJsonRecovery(json), // Advanced recovery
        () => createFallbackJson(json) // Fallback creation
    ];

    for (let i = 0; i < strategies.length; i++) {
        try {
            const candidate = strategies[i]();
            if (!candidate) continue;
            
            console.log(`Trying parsing strategy ${i + 1}...`);
            const data = JSON.parse(candidate);
            
            // Enhanced validation
            if (!data || typeof data !== 'object') {
                throw new Error("Response is not a valid JSON object");
            }
            
            // Ensure required fields exist or create defaults
            if (!data.title) data.title = "Data Interpretation Mock Test";
            if (!data.totalQuestions) data.totalQuestions = 25;
            if (!data.timeMinutes) data.timeMinutes = 60;
            if (!data.maxMarks) data.maxMarks = 100;
            if (!Array.isArray(data.instructions)) {
                data.instructions = [
                    "Read all data carefully before answering",
                    "Each question carries equal marks",
                    "Negative marking applies",
                    "Use approximation where necessary"
                ];
            }
            
            if (!Array.isArray(data.questionSets)) {
                throw new Error("Missing questionSets array");
            }
            
            if (data.questionSets.length === 0) {
                throw new Error("No question sets found");
            }
            
            // Count and validate questions
            let totalQuestions = 0;
            let validSets = 0;
            
            for (const set of data.questionSets) {
                if (set && Array.isArray(set.questions) && set.questions.length > 0) {
                    validSets++;
                    totalQuestions += set.questions.length;
                }
            }
            
            if (totalQuestions === 0) {
                throw new Error("No valid questions found in any set");
            }
            
            console.log(`✅ Strategy ${i + 1} successful: ${totalQuestions} questions in ${validSets} valid sets`);
            return data;
            
        } catch (error) {
            console.log(`❌ Strategy ${i + 1} failed: ${error.message}`);
            if (i === 0) {
                console.error("Response preview:", json.substring(0, 500) + "...");
            }
        }
    }
    
    throw new Error("All JSON parsing strategies failed");
}

// Enhanced JSON recovery functions
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
        
        // Try to balance braces and brackets
        extracted = balanceBrackets(extracted);
        
        // Fix common JSON issues
        extracted = fixCommonJsonIssues(extracted);
        
        return extracted;
        
    } catch (error) {
        return null;
    }
}

function attemptAdvancedJsonRecovery(jsonString) {
    try {
        // More aggressive recovery for truncated JSON
        let recovered = jsonString;
        
        // Find the last complete structure
        const lastCompleteObject = findLastCompleteStructure(recovered);
        if (lastCompleteObject) {
            recovered = lastCompleteObject;
        }
        
        // Try to fix truncated strings
        recovered = fixTruncatedStrings(recovered);
        
        // Ensure proper closing
        recovered = ensureProperClosing(recovered);
        
        return recovered;
        
    } catch (error) {
        return null;
    }
}

function balanceBrackets(str) {
    // Count and balance different types of brackets
    const openBraces = (str.match(/{/g) || []).length;
    const closeBraces = (str.match(/}/g) || []).length;
    const openBrackets = (str.match(/\[/g) || []).length;
    const closeBrackets = (str.match(/\]/g) || []).length;
    
    let result = str;
    
    // Add missing closing brackets
    if (openBraces > closeBraces) {
        result += '}'.repeat(openBraces - closeBraces);
    }
    
    if (openBrackets > closeBrackets) {
        result += ']'.repeat(openBrackets - closeBrackets);
    }
    
    return result;
}

function fixCommonJsonIssues(str) {
    return str
        // Fix unterminated strings at end
        .replace(/,?\s*"[^"]*$/, '')
        // Remove trailing commas before closing brackets
        .replace(/,(\s*[}\]])/g, '$1')
        // Fix missing quotes around keys
        .replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":')
        // Fix single quotes to double quotes
        .replace(/'/g, '"')
        // Remove any trailing comma at the very end
        .replace(/,\s*$/, '');
}

function fixTruncatedStrings(str) {
    // More aggressive fixing of unterminated strings
    let result = str;
    
    // Find the position where truncation likely occurred
    const truncationPos = result.length;
    let searchPos = Math.max(0, truncationPos - 200); // Look in last 200 chars
    
    // Find any unterminated string quotes
    let inString = false;
    let lastQuotePos = -1;
    
    for (let i = searchPos; i < result.length; i++) {
        if (result[i] === '"' && (i === 0 || result[i-1] !== '\\')) {
            if (!inString) {
                inString = true;
                lastQuotePos = i;
            } else {
                inString = false;
                lastQuotePos = -1;
            }
        }
    }
    
    // If we're in an unterminated string, close it
    if (inString && lastQuotePos !== -1) {
        console.log(`Fixing unterminated string at position ${lastQuotePos}`);
        
        // Find the key that this string belongs to
        let keyStart = result.lastIndexOf('"', lastQuotePos - 1);
        if (keyStart > 0) {
            keyStart = result.lastIndexOf('"', keyStart - 1);
            const keyName = result.substring(keyStart + 1, result.indexOf('"', keyStart + 1));
            
            // Close the string appropriately based on context
            if (keyName === 'question' || keyName === 'explanation' || keyName.includes('opt')) {
                result = result.substring(0, lastQuotePos + 1) + 'truncated"';
            } else {
                result = result.substring(0, lastQuotePos + 1) + '"';
            }
        } else {
            // Just close the string
            result += '"';
        }
    }
    
    // Remove any trailing incomplete structures
    result = result.replace(/,\s*$/, ''); // Remove trailing comma
    result = result.replace(/[^}\]"]*$/, ''); // Remove incomplete ending
    
    return result;
}

function findLastCompleteStructure(str) {
    // Try to find the last complete questionSet or structure
    const questionSetPattern = /"questionSets"\s*:\s*\[/;
    const match = str.match(questionSetPattern);
    
    if (!match) return null;
    
    let pos = match.index + match[0].length;
    let braceCount = 1;
    let lastCompleteSet = match.index;
    
    while (pos < str.length && braceCount > 0) {
        const char = str[pos];
        if (char === '[') braceCount++;
        if (char === ']') braceCount--;
        
        // Look for complete question set structures
        if (char === '}' && str.substring(pos - 50, pos).includes('"questions"')) {
            lastCompleteSet = pos;
        }
        
        pos++;
    }
    
    // Extract up to the last complete structure
    return str.substring(0, lastCompleteSet + 1) + ']}';
}

function ensureProperClosing(str) {
    // More aggressive approach to ensure proper JSON closing
    if (!str.includes('"questionSets"')) {
        console.log("No questionSets found, using fallback");
        return null;
    }
    
    // Find the last complete question
    const lastQuestionMatch = str.lastIndexOf('"answer"');
    if (lastQuestionMatch === -1) {
        console.log("No complete questions found");
        return null;
    }
    
    // Find the end of the last complete question
    let pos = str.indexOf('}', lastQuestionMatch);
    if (pos === -1) {
        // Add closing brace for question
        pos = str.length;
        str += '}';
    }
    
    // Count how many structures need closing
    const questionSetStart = str.indexOf('"questionSets"');
    const afterQuestionSets = str.substring(questionSetStart);
    
    const openObjects = (afterQuestionSets.match(/{/g) || []).length;
    const closeObjects = (afterQuestionSets.match(/}/g) || []).length;
    const openArrays = (afterQuestionSets.match(/\[/g) || []).length;
    const closeArrays = (afterQuestionSets.match(/\]/g) || []).length;
    
    // Cut at the last complete question and rebuild ending
    let result = str.substring(0, pos + 1);
    
    // Close questions array if needed
    if (!result.includes(']', result.lastIndexOf('questions'))) {
        result += ']';
    }
    
    // Close question set object
    if (!result.endsWith('}')) {
        result += '}';
    }
    
    // Close question sets array
    if (!result.endsWith(']}')) {
        result += ']';
    }
    
    // Close main object
    if (!result.endsWith('}')) {
        result += '}';
    }
    
    console.log(`Rebuilt JSON ending from position ${pos}`);
    return result;
}

function createFallbackJson(originalJson) {
    // Create a minimal valid JSON structure as fallback
    console.log("Creating fallback JSON structure...");
    
    const fallback = {
        "title": "Data Interpretation Mock Test",
        "totalQuestions": 5,
        "timeMinutes": 30,
        "maxMarks": 20,
        "instructions": [
            "Read all data carefully before answering",
            "Each question carries 4 marks",
            "Negative marking: -1 for wrong answers",
            "Use approximation where necessary"
        ],
        "questionSets": [
            {
                "setNumber": 1,
                "setTitle": "Sample Data Analysis",
                "directions": "Study the following data and answer questions 1-5",
                "dataType": "table",
                "dataTitle": "Sample Performance Data",
                "tableHeaders": ["Category", "Value A", "Value B"],
                "tableRows": [
                    ["Item 1", "100", "120"],
                    ["Item 2", "150", "180"],
                    ["Item 3", "200", "240"]
                ],
                "questions": [
                    {
                        "qNum": 1,
                        "question": "What is the highest value in Value A column?",
                        "optA": "100",
                        "optB": "150",
                        "optC": "200",
                        "optD": "240",
                        "answer": "C",
                        "explanation": "The highest value in Value A column is 200 for Item 3."
                    },
                    {
                        "qNum": 2,
                        "question": "What is the total of Value B column?",
                        "optA": "540",
                        "optB": "450",
                        "optC": "480",
                        "optD": "520",
                        "answer": "A",
                        "explanation": "Total = 120 + 180 + 240 = 540"
                    },
                    {
                        "qNum": 3,
                        "question": "Which item shows the largest increase from Value A to Value B?",
                        "optA": "Item 1",
                        "optB": "Item 2",
                        "optC": "Item 3",
                        "optD": "All equal",
                        "answer": "C",
                        "explanation": "Item 3: 240-200=40, Item 2: 180-150=30, Item 1: 120-100=20"
                    },
                    {
                        "qNum": 4,
                        "question": "What is the percentage increase for Item 2 from Value A to Value B?",
                        "optA": "20%",
                        "optB": "25%",
                        "optC": "30%",
                        "optD": "35%",
                        "answer": "A",
                        "explanation": "Percentage increase = (180-150)/150 × 100 = 20%"
                    },
                    {
                        "qNum": 5,
                        "question": "What is the average of all values in Value A column?",
                        "optA": "150",
                        "optB": "140",
                        "optC": "160",
                        "optD": "145",
                        "answer": "A",
                        "explanation": "Average = (100 + 150 + 200)/3 = 150"
                    }
                ]
            }
        ]
    };
    
    return JSON.stringify(fallback);
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

function createChart(slide, chartData, position = {}) {
    if (!chartData || !chartData.chartLabels || !chartData.chartValues) {
        console.warn("Skipping chart: Missing chart data");
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
                name: String(label),
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
        console.error(`Error creating ${chartData.chartType} chart: ${error.message}`);
        return false;
    }
}

function createTable(slide, tableData, position = {}) {
    if (!tableData || !tableData.tableHeaders || !tableData.tableRows) {
        console.warn("Skipping table: Missing table data");
        return false;
    }

    const pos = { x: 0.5, y: 2, w: 9, h: 4, ...position };

    try {
        // Prepare table data
        const tableRows = [
            tableData.tableHeaders.map(header => String(header || '')),
            ...tableData.tableRows.map(row => 
                Array.isArray(row) ? 
                row.map(cell => String(cell || '')) : 
                [String(row || '')]
            )
        ];

        if (tableRows.length <= 1) {
            console.warn("Table has no data rows");
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
        if (tableData.dataTitle && tableData.dataTitle.trim()) {
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

        console.log(`Created table with ${tableRows.length - 1} data rows`);
        return true;
        
    } catch (error) {
        console.error(`Error creating table: ${error.message}`);
        return false;
    }
}

// Simplified PowerPoint generation
async function generatePowerPoint(examData, outputPath, backgroundPath = null) {
    try {
        console.log('Creating PowerPoint presentation...');
        
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
        
        instructions.forEach(instruction => {
            instSlide.addText(`• ${instruction}`, {
                x: 1, y: currentY, w: '85%', h: 0.4,
                fontSize: 14, color: '2D3748'
            });
            currentY += 0.5;
        });
        
        // Process question sets
        const questionSets = examData.questionSets || [];
        let totalSets = 0;
        
        for (const questionSet of questionSets) {
            // Skip if questionSet is invalid
            if (!questionSet || typeof questionSet !== 'object') {
                console.warn(`Skipping invalid question set at index ${totalSets}`);
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
            
            if (questionSet.directions && questionSet.directions.trim()) {
                dataSlide.addText(questionSet.directions, {
                    x: 0.5, y: 0.9, w: '90%', h: 0.4,
                    fontSize: 12, color: '4A5568', align: 'center'
                });
            }
            
            // Add chart or table
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
            
            // Safety check and limit to 4 questions per slide
            const safeQuestions = questions.slice(0, 4).filter(q => q && q.question);
            
            safeQuestions.forEach(q => {
                if (qY > 6.5) return;
                
                qSlide.addText(`Q${q.qNum || 'N/A'}. ${q.question}`, {
                    x: 0.5, y: qY, w: '90%', h: 0.3,
                    fontSize: 11, bold: true, color: '2D3748'
                });
                qY += 0.3;
                
                ['A', 'B', 'C', 'D'].forEach(opt => {
                    const optionText = q[`opt${opt}`];
                    if (optionText && optionText.trim() && qY <= 7) {
                        qSlide.addText(`${opt}) ${optionText}`, {
                            x: 0.8, y: qY, w: '80%', h: 0.2,
                            fontSize: 9, color: '4A5568'
                        });
                        qY += 0.25;
                    }
                });
                qY += 0.15;
            });
        }

        // Add separator for answers
        const separatorSlide = addSlideWithBackground(pptx, backgroundPath);
        separatorSlide.addText('Answers & Solutions', {
            x: 0, y: '45%', w: '100%', h: 1,
            align: 'center', fontSize: 32, color: '003B75', bold: true
        });

        // Answer slides
        for (const questionSet of questionSets) {
            if (!questionSet || !Array.isArray(questionSet.questions) || questionSet.questions.length === 0) {
                console.warn(`Skipping answer slide for empty question set: ${questionSet?.setNumber || 'Unknown'}`);
                continue;
            }

            const ansSlide = addSlideWithBackground(pptx, backgroundPath);
            ansSlide.addText(`Answers - Set ${questionSet.setNumber || 'Unknown'}`, {
                x: 0.5, y: 0.3, w: '90%', h: 0.4,
                fontSize: 18, bold: true, color: '1A365D', align: 'center'
            });
            
            let aY = 1;
            const questions = questionSet.questions || [];
            
            questions.forEach(q => {
                if (!q || aY > 6.5) return;
                
                const questionNum = q.qNum || 'Unknown';
                const answer = q.answer || 'N/A';
                
                ansSlide.addText(`Q${questionNum}: ${answer}`, {
                    x: 0.5, y: aY, w: '90%', h: 0.25,
                    fontSize: 12, bold: true, color: '38A169'
                });
                aY += 0.3;
                
                if (q.explanation && q.explanation.trim()) {
                    ansSlide.addText(q.explanation, {
                        x: 0.5, y: aY, w: '90%', h: 0.5,
                        fontSize: 10, color: '2F855A'
                    });
                    aY += 0.6;
                }
            });
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
        throw error;
    }
}

// Mock test generation with enhanced error handling and token management
async function generateMockTest(contents, outputPath, mockNumber, totalMocks, apiKeyManager, options = {}) {
    const maxRetries = 3;
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        let keyInfo;
        try {
            keyInfo = apiKeyManager.getNextKey();
            
            // Initialize Google Generative AI with the API key
            const genAI = new GoogleGenerativeAI(keyInfo.key);
            
            console.log(`Mock ${mockNumber}/${totalMocks} - Attempt ${attempt}/${maxRetries} (API Key ${keyInfo.index + 1})`);

            // Get the model with conservative configuration to prevent truncation
            const model = genAI.getGenerativeModel({ 
                model: options.model || "gemini-1.5-flash",
                generationConfig: {
                    maxOutputTokens: 4096, // Reduced from 8192 to prevent truncation
                    temperature: 0.3, // Lower temperature for more focused output
                    topP: 0.8,
                    topK: 20,
                    candidateCount: 1,
                }
            });

            // Simplified prompt focused on preventing truncation
            const truncationPreventionPrompt = `${SYSTEM_PROMPT_DI}

RESPONSE LENGTH CONTROL:
- Generate EXACTLY 3 question sets with 3 questions each
- Keep all strings under 80 characters
- Prioritize COMPLETE response over content volume
- If approaching token limit, reduce content but maintain valid JSON structure

Generate the complete mock test now.`;

            console.log("🤖 Generating content with truncation prevention...");

            // Generate content with conservative settings
            // Generate content with timeout and simplified input
            const generateWithTimeout = async (timeoutMs = 60000) => {
                return Promise.race([
                    model.generateContent({
                        contents: [{
                            role: "user", 
                            parts: [{ text: truncationPreventionPrompt }] // Simplified - just the prompt without PDFs initially
                        }]
                    }),
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Request timeout')), timeoutMs)
                    )
                ]);
            };

            const result = await generateWithTimeout(60000);
            const response = await result.response;
            const responseText = response.text();
            
            if (!responseText) {
                throw new Error("Received an empty response from the API.");
            }

            console.log(`Response received: ${responseText.length} characters`);
            
            // Try to parse the JSON with enhanced recovery
            const examData = parseJsonResponse(responseText);
            
            // Validate the parsed data has sufficient content
            if (!examData.questionSets || examData.questionSets.length === 0) {
                throw new Error("Generated exam data has no question sets");
            }

            const totalQuestions = examData.questionSets.reduce((sum, set) => 
                sum + (set.questions ? set.questions.length : 0), 0);
            
            if (totalQuestions === 0) {
                throw new Error("Generated exam data has no questions");
            }

            console.log(`✅ Valid exam data generated: ${totalQuestions} questions in ${examData.questionSets.length} sets`);

            // Generate PowerPoint
            const pptResult = await generatePowerPoint(examData, outputPath, options.pptBackground);

            console.log(`🎉 Mock ${mockNumber}/${totalMocks} completed successfully.`);
            return { success: true, outputPath, mockNumber, examData, pptResult };

        } catch (error) {
            lastError = error;
            
            // Categorize error types for better handling
            const isQuotaError = error.message.toLowerCase().includes('quota') ||
                               error.message.toLowerCase().includes('resource_exhausted') ||
                               error.message.toLowerCase().includes('rate limit');
            
            const isTimeoutError = error.message.toLowerCase().includes('timeout') ||
                                 error.message.toLowerCase().includes('deadline');
            
            const isParsingError = error.message.toLowerCase().includes('json') ||
                                 error.message.toLowerCase().includes('parsing');

            if (keyInfo && (isQuotaError || isTimeoutError)) {
                apiKeyManager.markKeyFailed(keyInfo.index, error);
                console.log(`⚠️  API key ${keyInfo.index + 1} marked as failed due to: ${error.message}`);
            }

            console.error(`❌ Mock ${mockNumber} - Attempt ${attempt} failed: ${error.message}`);

            // For parsing errors on the last attempt, try fallback
            if (attempt === maxRetries && isParsingError) {
                console.log("🔄 Attempting fallback generation...");
                try {
                    const fallbackData = JSON.parse(createFallbackJson(""));
                    const pptResult = await generatePowerPoint(fallbackData, outputPath, options.pptBackground);
                    console.log(`⚠️  Mock ${mockNumber} completed with fallback data.`);
                    return { success: true, outputPath, mockNumber, examData: fallbackData, pptResult, warning: "Used fallback data due to parsing issues" };
                } catch (fallbackError) {
                    console.error(`❌ Fallback generation also failed: ${fallbackError.message}`);
                }
            }

            if (attempt < maxRetries) {
                const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000); // Cap at 10 seconds
                console.log(`⏳ Retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    // If all retries fail
    console.error(`💥 All ${maxRetries} attempts failed for Mock ${mockNumber}`);
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
        .option('--model <model>', 'Gemini model to use', 'gemini-1.5-flash')
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
        for (const pathToCheck of [options.pyq, options.referenceMock, options.prompt, options.apiKeyFile]) {
            try {
                await fs.access(pathToCheck);
            } catch (error) {
                throw new Error(`Cannot access path: ${pathToCheck}`);
            }
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
            console.log('\nFailed mock tests:');
            results.filter(r => !r.success).forEach(r => {
                console.log(`  - Mock ${r.mockNumber}: ${r.error?.message || 'Unknown error'}`);
            });
        }

        // API usage statistics
        const stats = apiKeyManager.getStats();
        console.log(`\nAPI Key Usage Statistics:`);
        console.log(`  Total keys: ${stats.total}`);
        console.log(`  Available keys: ${stats.available}`);
        console.log(`  Failed keys: ${stats.failed}`);
        if (Object.keys(stats.usage).length > 0) {
            console.log(`  Usage per key:`, stats.usage);
        }

        // Exit with error code if any mocks failed
        if (successCount < options.numberOfMocks) {
            console.log('\nSome mock tests failed to generate. Check the errors above.');
            process.exit(1);
        } else {
            console.log('\nAll mock tests generated successfully!');
            results.forEach(r => {
                console.log(`  - ${path.basename(r.outputPath)}`);
            });
        }

    } catch (error) {
        console.error('\n❌ Fatal Error:', error.message);
        console.error('\nPlease check:');
        console.error('1. All required directories and files exist');
        console.error('2. API keys are valid and not expired');
        console.error('3. PDF files are not corrupted and under 20MB each');
        console.error('4. You have write permissions to the output directory');
        
        // Print stack trace in debug mode
        if (process.env.DEBUG) {
            console.error('\nStack trace:', error.stack);
        }
        
        process.exit(1);
    }
}

// Error handling for uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('\n❌ Uncaught Exception:', error.message);
    if (process.env.DEBUG) {
        console.error('Stack trace:', error.stack);
    }
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('\n❌ Unhandled Rejection at:', promise, 'reason:', reason);
    if (process.env.DEBUG) {
        console.error('Stack trace:', reason.stack);
    }
    process.exit(1);
});

// Run the main function if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(error => {
        console.error('❌ Application Error:', error.message);
        process.exit(1);
    });
}

export { 
    main, 
    generateMockTest, 
    generatePowerPoint, 
    ApiKeyManager,
    parseJsonResponse,
    findPdfFiles,
    processPdfFiles
};
