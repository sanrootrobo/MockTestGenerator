// --- MAIN EXECUTION LOGIC ---
async function main() {
    program
        .requiredOption("--pyq <dir>", "Directory containing previous year question PDFs")
        .requiredOption("--reference-mock <dir>", "Directory containing reference mock PDFs")
        .requiredOption("-o, --output <filename>", "Base output filename for generated files")
        .requiredOption("--prompt <file>", "Path to user prompt file containing specific instructions for the Data Interpretation mock test")
        .option("--api-key-file <file>", "Optional: Path to API key file (default: api_key.txt)")
        .option("--number-of-mocks <number>", "Number of Data Interpretation mock tests to generate (default: 1)", "1")
        .option("--max-tokens <number>", "Maximum output tokens per request (default: 8192)", parseInt, 8192)
        .option("--temperature <number>", "Temperature for response generation (0.0-2.0, default: 0.7)", parseFloat, 0.7)
        .option("--concurrent-limit <number>", "Maximum concurrent API requests (default: 3)", parseInt, 3)
        .option("--rate-limit-delay <number>", "Delay between API requests in ms (default: 1000)", parseInt, 1000)
        .option("--thinking-budget <number>", "Thinking budget tokens for internal reasoning. Use -1 for dynamic, 0 to disable, or specific number (Flash: 1-24576, Flash-Lite: 512-24576, Pro: 128-32768)")
        .option("--model <model>", "Gemini model to use (default: gemini-2.5-flash)", "gemini-2.5-flash")
        .option("--ppt", "Generate a PowerPoint (.pptx) file optimized for Data Interpretation with dedicated chart slides")
        .option("--ppt-background <file>", "Background image file for PowerPoint slides")
        .option("--save-json", "Save the raw generated JSON to a debug file")
        .option("--save-html", "Save the generated HTML to a debug file")
        .parse(process.argv);

    const options = program.opts();
    const apiKeyFile = options.apiKeyFile || "api_key.txt";
    const numberOfMocks = parseInt(options.numberOfMocks) || 1; 
    const maxConcurrent = options.concurrentLimit || 3;
    const rateDelay = options.rateLimitDelay || 1000;
    const thinkingBudget = options.thinkingBudget;
    const modelName = options.model || "gemini-2.5-flash";

    if (!numberOfMocks || isNaN(numberOfMocks) || numberOfMocks < 1) {
        console.error(`Error: --number-of-mocks must be a positive integer, got: ${numberOfMocks}`);
        process.exit(1);
    }

    // Check for Puppeteer
    try {
        await import('puppeteer');
        console.log('Puppeteer available - PDF generation is enabled.');
    } catch (error) {
        console.error('Puppeteer is required for PDF generation but is not installed.');
        console.error('Please install it with: npm install puppeteer');
        process.exit(1);
    }

    // Check for PptxGenJS if PPT is requested
    if (options.ppt) {
        try {
            await import('pptxgenjs');
            console.log('PptxGenJS available - PowerPoint generation with optimized Data Interpretation layout is enabled.');
        } catch (error) {
            console.error('PptxGenJS is required for PowerPoint generation but is not installed.');
            console.error('Please install it with: npm install pptxgenjs');
            process.exit(1);
        }
    }

    try {
        // 1. Validate directories first
        console.log("Validating directories...");
        await validateDirectories(options.pyq, options.referenceMock);

        // 2. Set up the API Key Manager
        console.log(`Reading API keys from: ${apiKeyFile}`);
        let apiKeys = [];
        try {
            const apiKeyContent = await fs.readFile(apiKeyFile, "utf-8");
            apiKeys = apiKeyContent.split('\n').map(key => key.trim()).filter(key => key.length > 0);
            
            apiKeys = apiKeys.map(validateApiKey);
            
            if (apiKeys.length === 0) {
                throw new Error("No valid API keys found");
            }
            
        } catch (error) {
            if (error.code === 'ENOENT') {
                console.error(`\nError: '${apiKeyFile}' not found. Please create this file and place your API key(s) inside it (one per line).`);
            } else {
                console.error(`\nError reading API keys: ${error.message}`);
            }
            process.exit(1);
        }

        apiKeyManager = new ApiKeyManager(apiKeys);

        // 3. Read user prompt file
        let userPrompt = "";
        try {
            userPrompt = await fs.readFile(options.prompt, "utf-8");
            console.log(`Using Data Interpretation prompt from: ${options.prompt}`);
        } catch (error) {
            console.error(`\nError reading prompt file '${options.prompt}': ${error.message}`);
            process.exit(1);
        }

        if (!userPrompt.trim()) {
            console.error("Error: Prompt file is empty.");
            process.exit(1);
        }

        // 4. Process PDF Files
        console.log("\nProcessing input files for Data Interpretation mock generation...");
        const pyqFiles = await findPdfFiles(options.pyq);
        const refMockFiles = await findPdfFiles(options.referenceMock);

        console.log(`Found ${pyqFiles.length} PYQ PDF files`);
        console.log(`Found ${refMockFiles.length} reference mock PDF files`);

        if (pyqFiles.length === 0 && refMockFiles.length === 0) {
            console.error("\nError: No PDF files found in the provided directories. Aborting.");
            process.exit(1);
        }

        const pyqParts = await filesToGenerativeParts(pyqFiles, "PYQ");
        const refMockParts = await filesToGenerativeParts(refMockFiles, "Reference Mock");

        if (pyqParts.length === 0 && refMockParts.length === 0) {
            console.error("\nError: No valid PDF files could be processed. Aborting.");
            process.exit(1);
        }

        // 5. Construct the API Request content
        const contents = [
            { text: systemPrompt },
            { text: "--- REFERENCE PYQ PDFS ---" },
            ...pyqParts,
            { text: "--- REFERENCE MOCK TEST PDFS ---" },
            ...refMockParts,
            { text: "--- USER INSTRUCTIONS FOR DATA INTERPRETATION MOCK ---" },
            { text: userPrompt }
        ];

        // 6. Generate Data Interpretation mock tests
        console.log(`\nStarting generation of ${numberOfMocks} Data Interpretation mock test(s)...`);
        let outputFormats = ["JSON", "PDF"];
        if (options.ppt) outputFormats.push("PowerPoint (Chart-Optimized)");
        console.log(`Output Formats: ${outputFormats.join(', ')}`);
        if (options.saveJson) {
            console.log("Debug JSON files will be saved.");
        }
        if (options.saveHtml) {
            console.log("Debug HTML files will be saved.");
        }
        
        const startTime = Date.now();
        
        const generationTasks = [];
        for (let i = 1; i <= numberOfMocks; i++) {
            const outputPath = generateOutputFilename(options.output, i, numberOfMocks, '.pdf');
            generationTasks.push(() => generateSingleMock(contents, outputPath, i, numberOfMocks, options));
        }

        // Execute tasks with concurrency limit
        const results = [];
        for(let i=0; i<generationTasks.length; i+=maxConcurrent) {
            const batch = generationTasks.slice(i, i+maxConcurrent).map(task => task());
            const batchResults = await Promise.allSettled(batch);
            results.push(...batchResults);
        }
        
        const endTime = Date.now();
        const totalTime = (endTime - startTime) / 1000;

        // Process results
        const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).map(r => r.value);
        const failed = results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success));

        console.log(`\nData Interpretation Mock Generation Summary:`);
        console.log(`Successful: ${successful.length}/${numberOfMocks}`);
        console.log(`Failed: ${failed.length}/${numberOfMocks}`);
        console.log(`Total time: ${totalTime.toFixed(2)} seconds`);
        
        if (successful.length > 0) {
            console.log(`\nGenerated Files:`);
            successful.sort((a,b) => a.mockNumber - b.mockNumber).forEach(mockResult => {
                console.log(`  PDF: ${path.basename(mockResult.outputPath)} (${mockResult.contentLength} chars, API Key ${mockResult.keyIndex + 1})`);
                if (options.ppt) {
                    const pptOutputPath = generateOutputFilename(options.output, mockResult.mockNumber, numberOfMocks, '.pptx');
                    console.log(`  PowerPoint: ${path.basename(pptOutputPath)} (Chart-Optimized Layout)`);
                }
                if (options.saveJson) {
                    const debugJsonPath = generateDebugJsonFilename(options.output, mockResult.mockNumber, numberOfMocks);
                    console.log(`  DEBUG JSON: ${path.basename(debugJsonPath)}`);
                }
                if (options.saveHtml) {
                    const debugHtmlPath = generateDebugHtmlFilename(options.output, mockResult.mockNumber, numberOfMocks);
                    console.log(`  DEBUG HTML: ${path.basename(debugHtmlPath)}`);
                }
            });
            
            console.log(`\nData Interpretation Features:`);
            console.log(`- Dedicated chart slides in PowerPoint`);
            console.log(`- Comprehensive SVG charts (pie, bar, line, tables)`);
            console.log(`- Mathematical step-by-step solutions`);
            console.log(`- Single direction box per question set`);
            console.log(`- Optimized layout for chart visibility`);
        }

        if (failed.length > 0) {
            console.log(`\nFailed generations:`);
            failed.forEach((result, i) => {
                const error = result.reason || result.value?.error;
                const outputPath = result.value?.outputPath || `Task for mock ${i+1}`;
                console.log(`  - Mock for ${path.basename(outputPath)}: ${error?.message || 'Unknown error'}`);
            });
        }

        if (successful.length === 0) {
            console.error("\nAll Data Interpretation mock test generations failed!");
            process.exit(1);
        }

        console.log(`\nSuccessfully generated ${successful.length} Data Interpretation mock test(s)!`);
        console.log(`Each mock includes professionally designed charts and analytical questions.`);

    } catch (error) {
        console.error("\nAn unexpected error occurred:");
        console.error(`- ${error.message}`);
        console.error("\nStack trace:");
        console.error(error.stack);
        process.exit(1);
    }
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    process.exit(1);
});

// Run the main function
main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});import { GoogleGenAI } from "@google/genai";
import { program } from "commander";
import * as fs from "fs/promises";
import * as path from "path";
import puppeteer from "puppeteer";
import PptxGenJS from 'pptxgenjs';
import { Buffer } from 'buffer';

// --- UPDATED SYSTEM PROMPT FOR DATA INTERPRETATION ---
const systemPrompt = `You are an expert exam designer and question creator specializing in DATA INTERPRETATION questions for competitive entrance exams. Your primary task is to generate a BRAND NEW, high-quality data interpretation mock test with charts, graphs, and analytical questions.

Follow these rules with absolute precision:

1.  **Analyze Reference Materials:**
    *   Carefully study all the provided "REFERENCE PYQ PDF" documents to understand question styles, common topics, difficulty level, and typical phrasing for data interpretation questions.
    *   Examine the "REFERENCE Mock Test PDF" documents to understand their structure and the tone of their instructions.

2.  **Generate Original Content:**
    *   You MUST NOT copy any questions or passages directly from the reference materials.
    *   All questions, options, solutions, and DATA CHARTS you generate must be entirely new and unique.
    *   Focus on creating realistic business/academic datasets with meaningful relationships.

3.  **Data Interpretation Requirements:**
    *   Each question set should include ONE comprehensive chart/graph (pie chart, bar chart, line graph, table, etc.)
    *   Generate 3-5 questions per chart that test different analytical skills:
        - Reading exact values from the chart
        - Calculating percentages and ratios
        - Finding trends and patterns
        - Making comparisons between data points
        - Drawing logical conclusions from data
    *   Use realistic data themes: sales figures, demographics, survey results, academic performance, economic indicators, etc.

4.  **Chart/SVG Requirements:**
    *   Create detailed, professional-looking charts using SVG
    *   Include proper labels, legends, gridlines, and titles
    *   Use distinct colors and clear formatting
    *   Ensure all data is readable and mathematically consistent
    *   Charts should contain 5-8 data points for optimal question variety

5.  **Format as a Single, Complete JSON Object:**
    *   The ENTIRE output MUST be a single JSON object. Do not wrap it in markdown or add any text outside the JSON structure.
    *   The JSON object must strictly adhere to the following schema:
    \`\`\`json
    {
      "examTitle": "String", // e.g., "Data Interpretation Mock Test"
      "examDetails": {
        "totalQuestions": Number,
        "timeAllotted": "String", // e.g., "45 Minutes"
        "maxMarks": Number
      },
      "instructions": {
        "title": "String", // e.g., "Instructions"
        "points": ["String", "String", ...] // An array of instruction points specific to DI tests
      },
      "sections": [
        {
          "sectionTitle": "String", // e.g., "Data Interpretation"
          "questionSets": [
            {
              "type": "group", // Always "group" for DI - questions share a chart
              "directions": { // Show once per question set
                "title": "String", // e.g., "Directions for questions 1-4:"
                "text": "String" // The directions text for this chart
              },
              "chartData": { // NEW: Dedicated chart object
                "title": "String", // Chart title
                "description": "String", // Brief description of what the chart shows
                "svg": "String" // The comprehensive SVG chart
              },
              "questions": [
                {
                  "questionNumber": "String", // e.g., "1", "2", etc.
                  "questionText": "String", // The question text
                  "options": [
                    {
                      "label": "String", // "A", "B", etc.
                      "text": "String" // The option text
                    }
                  ],
                  "solution": {
                    "answer": "String", // e.g., "Option (C)"
                    "steps": [
                      "String", // Step 1: brief calculation/reasoning
                      "String", // Step 2: brief calculation/reasoning
                      "String"  // Step 3: brief calculation/reasoning, etc.
                    ]
                  }
                }
              ]
            }
          ]
        }
      ]
    }
    \`\`\`

6.  **Content Rules:**
    *   Ensure every question has a corresponding solution with clear answer and step-by-step calculations.
    *   The \`questionNumber\` for each question must be unique.
    *   Generate content based on the user prompt and reference materials, ensuring all calculations are mathematically correct.
    *   **Solution Structure Requirements:**
        *   The \`steps\` field must contain brief, ordered calculation steps.
        *   Each step should show the mathematical reasoning clearly.
        *   Include specific numbers from the chart in calculations.
        *   Final step should state the correct answer choice.

7. **Chart Types to Generate:**
   *   **Pie Charts**: Market share, budget allocation, demographic distribution
   *   **Bar Charts**: Sales comparison, performance metrics, survey results
   *   **Line Graphs**: Trends over time, growth patterns
   *   **Tables**: Complex datasets with multiple variables
   *   **Combination Charts**: Mix of chart types for comprehensive analysis`;

// --- ENHANCED JSON TO HTML CONVERSION ---
function convertJsonToHtml(jsonData) {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${jsonData.examTitle}</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
        
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6;
            color: #2d3748;
            background-color: #ffffff;
            font-size: 14px;
            max-width: none;
            margin: 0;
            padding: 20px;
        }
        
        /* Header Styling */
        .test-header {
            text-align: center;
            margin-bottom: 32px;
            padding: 20px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border-radius: 12px;
            page-break-after: avoid;
        }
        
        .test-header h1 {
            color: white;
            font-size: 28px;
            font-weight: 700;
            margin-bottom: 8px;
            border: none;
        }
        
        .test-info {
            display: flex;
            justify-content: space-around;
            margin-top: 16px;
            font-size: 14px;
        }
        
        .test-info-item {
            text-align: center;
        }
        
        .test-info-label {
            font-weight: 300;
            opacity: 0.9;
        }
        
        .test-info-value {
            font-weight: 600;
            font-size: 16px;
        }
        
        /* Instructions */
        .instructions {
            background: #fffaf0;
            border: 2px solid #fbd38d;
            border-radius: 8px;
            padding: 16px;
            margin: 16px 0;
            page-break-inside: avoid;
        }
        
        .instructions h2 {
            color: #c05621;
            font-size: 22px;
            font-weight: 600;
            margin: 0 0 12px 0;
        }
        
        .instructions ul {
            list-style-type: disc;
            margin-left: 20px;
        }
        
        .instructions li {
            margin: 8px 0;
            font-size: 14px;
        }
        
        /* Section Headers */
        .section-header {
            background: #f8f9fa;
            border: 2px solid #dee2e6;
            border-radius: 8px;
            padding: 15px 20px;
            margin: 25px 0 20px 0;
            text-align: center;
            page-break-after: avoid;
        }
        
        .section-title {
            font-size: 18px;
            font-weight: 600;
            color: #495057;
            margin: 0;
        }
        
        /* Data Interpretation Specific Styles */
        .chart-container {
            background: #f7fafc;
            border: 2px solid #e2e8f0;
            border-radius: 12px;
            padding: 20px;
            margin: 20px 0;
            text-align: center;
            page-break-inside: avoid;
        }
        
        .chart-title {
            font-size: 18px;
            font-weight: 600;
            color: #2b6cb0;
            margin-bottom: 8px;
        }
        
        .chart-description {
            font-size: 14px;
            color: #4a5568;
            margin-bottom: 16px;
            font-style: italic;
        }
        
        .chart-svg {
            display: flex;
            justify-content: center;
            margin: 16px 0;
        }
        
        .chart-svg svg {
            max-width: 100%;
            height: auto;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            background: white;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        
        /* Directions - Only shown once per question set */
        .directions {
            background: #f0f9ff;
            border: 1px solid #bae6fd;
            border-radius: 6px;
            padding: 12px;
            margin: 16px 0;
            font-style: italic;
            color: #0c4a6e;
        }
        
        .directions-title {
            font-weight: 600;
            margin-bottom: 8px;
            color: #0369a1;
        }
        
        /* Questions */
        .question {
            background: #f7fafc;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 16px;
            margin: 12px 0;
            page-break-inside: avoid;
        }
        
        .question-number {
            font-weight: 600;
            color: #2b6cb0;
            font-size: 16px;
        }
        
        .question-text {
            margin: 8px 0 12px 0;
            font-size: 14px;
            line-height: 1.6;
        }
        
        .options {
            margin: 12px 0;
        }
        
        .option {
            display: block;
            margin: 6px 0;
            padding: 8px 12px;
            background: #ffffff;
            border: 1px solid #e2e8f0;
            border-radius: 4px;
            font-size: 13px;
        }
        
        /* Answer Section */
        .answer-solutions {
            background: #f0fff4;
            border: 2px solid #38a169;
            border-radius: 8px;
            padding: 20px;
            margin: 32px 0;
            page-break-before: always;
        }
        
        .answer-solutions h2 {
            color: #22543d;
            font-size: 22px;
            font-weight: 600;
            margin-bottom: 16px;
            border-left: 4px solid #38a169;
            padding-left: 12px;
        }
        
        .answer-item {
            margin: 12px 0;
            padding: 12px;
            background: #ffffff;
            border-radius: 6px;
            border: 1px solid #c6f6d5;
            page-break-inside: avoid;
        }
        
        .answer-key {
            font-weight: 600;
            color: #22543d;
            font-size: 15px;
            margin-bottom: 8px;
        }
        
        .answer-steps {
            color: #2f855a;
            font-size: 14px;
            line-height: 1.5;
        }
        
        .answer-steps ol {
            margin-left: 20px;
        }
        
        .answer-steps li {
            margin: 4px 0;
        }
        
        /* Print Optimizations */
        @media print {
            body {
                font-size: 12px;
                line-height: 1.4;
                padding: 10px;
            }
            
            .test-header h1 {
                font-size: 24px;
            }
            
            .chart-container {
                page-break-inside: avoid;
                margin: 16px 0;
            }
            
            .question {
                margin: 10px 0;
                padding: 10px;
            }
        }
    </style>
</head>
<body>
    <div class="test-header">
        <h1>${jsonData.examTitle}</h1>
        <div class="test-info">
            <div class="test-info-item">
                <div class="test-info-label">Questions</div>
                <div class="test-info-value">${jsonData.examDetails.totalQuestions}</div>
            </div>
            <div class="test-info-item">
                <div class="test-info-label">Time</div>
                <div class="test-info-value">${jsonData.examDetails.timeAllotted}</div>
            </div>
            <div class="test-info-item">
                <div class="test-info-label">Marks</div>
                <div class="test-info-value">${jsonData.examDetails.maxMarks}</div>
            </div>
        </div>
    </div>

    <div class="instructions">
        <h2>${jsonData.instructions.title}</h2>
        <ul>
            ${jsonData.instructions.points.map(point => `<li>${point}</li>`).join('')}
        </ul>
    </div>

    ${jsonData.sections.map(section => `
        <div class="section-header">
            <h2 class="section-title">${section.sectionTitle}</h2>
        </div>
        
        ${section.questionSets.map(questionSet => `
            <!-- Directions shown once per question set -->
            ${questionSet.directions ? `
                <div class="directions">
                    <div class="directions-title">${questionSet.directions.title}</div>
                    <div>${questionSet.directions.text}</div>
                </div>
            ` : ''}
            
            <!-- Chart display for data interpretation -->
            ${questionSet.chartData ? `
                <div class="chart-container">
                    <div class="chart-title">${questionSet.chartData.title}</div>
                    <div class="chart-description">${questionSet.chartData.description}</div>
                    <div class="chart-svg">
                        ${questionSet.chartData.svg}
                    </div>
                </div>
            ` : ''}
            
            <!-- Questions related to the chart -->
            ${questionSet.questions.map(question => `
                <div class="question">
                    <span class="question-number">${question.questionNumber}.</span>
                    <div class="question-text">${question.questionText}</div>
                    
                    <div class="options">
                        ${question.options.map(option => `
                            <div class="option">
                                <strong>${option.label})</strong> ${option.text}
                            </div>
                        `).join('')}
                    </div>
                </div>
            `).join('')}
        `).join('')}
    `).join('')}

    <div class="answer-solutions">
        <h2>Answer Key & Solutions</h2>
        ${jsonData.sections.map(section => 
            section.questionSets.map(questionSet => 
                questionSet.questions.map(question => `
                    <div class="answer-item">
                        <div class="answer-key">${question.questionNumber}: ${question.solution.answer}</div>
                        <div class="answer-steps">
                            <ol>
                                ${question.solution.steps.map(step => `<li>${step}</li>`).join('')}
                            </ol>
                        </div>
                    </div>
                `).join('')
            ).join('')
        ).join('')}
    </div>
</body>
</html>`;

    return html;
}

// --- ENHANCED POWERPOINT FUNCTIONS FOR DATA INTERPRETATION ---


/*
function createChartSlide(pptx, questionSet, bgImagePath) {
    const slide = addSlideWithBackground(pptx, bgImagePath);

    // Add directions at the top if available
    if (questionSet.directions) {
        slide.addText(questionSet.directions.title, {
            x: 0.5, y: 0.25, w: '90%', h: 0.4,
            fontSize: 16, fontFace: 'Calibri',
            bold: true, color: '003B75'
        });
        slide.addText(questionSet.directions.text, {
            x: 0.5, y: 0.7, w: '90%', h: 0.5,
            fontSize: 12, fontFace: 'Calibri',
            color: '333333'
        });
    }

    // Add chart title
    if (questionSet.chartData) {
        slide.addText(questionSet.chartData.title, {
            x: 0.5, y: 1.3, w: '90%', h: 0.5,
            fontSize: 20, fontFace: 'Calibri',
            bold: true, color: '003B75', align: 'center'
        });

        // Add the chart with responsive sizing
        const base64Svg = svgToBase64(questionSet.chartData.svg);
        if (base64Svg) {
            // Calculate available space dynamically
            const slideWidth = 10; // Standard slide width
            const slideHeight = 7.5; // Standard slide height
            const marginX = 0.5;
            const marginY = 0.3;

            // Calculate chart area based on content above
            const chartStartY = questionSet.directions ? 2.0 : 1.8;
            const availableWidth = slideWidth - (marginX * 2);
            const availableHeight = slideHeight - chartStartY - marginY;

            slide.addImage({
                data: base64Svg,
                x: marginX,
                y: chartStartY,
                w: availableWidth,
                h: availableHeight,
                sizing: {
                    type: 'contain',
                    w: availableWidth,
                    h: availableHeight
                }
            });
        }
    }
}
*/

function createChartSlide(pptx, questionSet, bgImagePath) {
    const slide = addSlideWithBackground(pptx, bgImagePath);

    // Add directions at the top if available
    if (questionSet.directions) {
        slide.addText(questionSet.directions.title, {
            x: 0.5, y: 0.25, w: '90%', h: 0.4,
            fontSize: 16, fontFace: 'Calibri',
            bold: true, color: '003B75'
        });
        slide.addText(questionSet.directions.text, {
            x: 0.5, y: 0.7, w: '90%', h: 0.5,
            fontSize: 12, fontFace: 'Calibri',
            color: '333333'
        });
    }

    // Add chart title
    if (questionSet.chartData) {
        slide.addText(questionSet.chartData.title, {
            x: 0.5, y: 1.3, w: '90%', h: 0.5,
            fontSize: 20, fontFace: 'Calibri',
            bold: true, color: '003B75', align: 'center'
        });

        const base64Svg = svgToBase64(questionSet.chartData.svg);
        if (base64Svg) {
            slide.addImage({
                data: base64Svg,
                x: 0.5, y: 2.0,
                w: 9,   // max width
                h: 5.0, // max height
                sizing: { type: 'contain' } // zooms down proportionally, no cropping
            });
        }
    }
}


function createQuestionSlide(pptx, question, bgImagePath) {
    const slide = addSlideWithBackground(pptx, bgImagePath);

    // Question number
    slide.addText(`Question ${question.questionNumber}`, {
        x: 0.5, y: 0.5, w: '90%', h: 0.6,
        fontSize: 11, fontFace: 'Calibri',
        bold: true, color: '003B75'
    });

    // Question text
    const questionTop = 1.2;
    const questionHeight = 1.0; // increased to allow multi-line wrapping
    slide.addText(question.questionText, {
        x: 0.5, y: questionTop, w: '90%', h: questionHeight,
        fontSize: 16, fontFace: 'Calibri',
        wrap: true
    });

    // Options - start below the question text
    let optionY = questionTop + questionHeight + 0.2; // space after question
    question.options.forEach(option => {
        slide.addText(`${option.label}) ${option.text}`, {
            x: 0.75, y: optionY, w: '80%', h: 0.4,
            fontSize: 14, fontFace: 'Calibri',
            valign: 'top',
            wrap: true
        });
        optionY += 0.5; // spacing between options
    });
}


/*
 function createQuestionSlide(pptx, question, bgImagePath) {
    const slide = addSlideWithBackground(pptx, bgImagePath);

    // Question number
    slide.addText(`Question ${question.questionNumber}`, {
        x: 0.5, y: 0.5, w: '90%', h: 0.5,
        fontSize: 24, fontFace: 'Calibri',
        bold: true, color: '003B75'
    });

    // Question text
    slide.addText(question.questionText, {
        x: 0.5, y: 1.2, w: '90%', h: 0.3,
        fontSize: 11, fontFace: 'Calibri',
        wrap: true
    });

    // Options - starting closer to question text
    let optionY = 1.2;
    question.options.forEach(option => {
        slide.addText(`${option.label}) ${option.text}`, {
            x: 0.75, y: optionY, w: '70%', h: 0.2,
            fontSize: 16, fontFace: 'Calibri'
        });
        optionY += 0.3;
    });
}

*/


function createAnswerSlide(pptx, question, bgImagePath) {
    const slide = addSlideWithBackground(pptx, bgImagePath);

    // Answer title
    slide.addText(`Solution for Question ${question.questionNumber}`, {
        x: 0.5, y: 0.5, w: '90%', h: 0.5,
        fontSize: 24, fontFace: 'Calibri',
        bold: true, color: '003B75'
    });

    // Correct Answer
    slide.addText(`Correct Answer: ${question.solution.answer}`, {
        x: 0.5, y: 1.5, w: '90%', h: 0.4,
        fontSize: 18, fontFace: 'Calibri',
        bold: true, color: '008000'
    });

    // Steps
    slide.addText("Step-by-step solution:", {
        x: 0.5, y: 2.2, w: '90%', h: 0.4,
        fontSize: 16, fontFace: 'Calibri',
        bold: true
    });

    const stepsText = question.solution.steps.map((step, index) => `${index + 1}. ${step}`).join('\n');
    slide.addText(stepsText, {
        x: 0.75, y: 2.8, w: '85%', h: 3.5,
        fontSize: 14, fontFace: 'Calibri',
        wrap: true
    });
}


// Enhanced SVG to Base64 conversion with better error handling
function svgToBase64(svgContent) {
    if (!svgContent || !svgContent.includes('<svg')) return null;
    
    const svgMatch = svgContent.match(/<svg[^>]*>[\s\S]*?<\/svg>/i);
    if (!svgMatch) return null;

    let svgString = svgMatch[0];

    // Ensure SVG has proper dimensions for charts
    if (!svgString.includes('viewBox=')) {
        svgString = svgString.replace('<svg', '<svg viewBox="0 0 800 600"');
    }

    // Set standard dimensions for consistency
    svgString = svgString.replace(/<svg([^>]*)>/i, (match, attributes) => {
        let newAttributes = attributes;
        if (!attributes.includes('width=')) {
            newAttributes += ' width="800"';
        }
        if (!attributes.includes('height=')) {
            newAttributes += ' height="600"';
        }
        return `<svg${newAttributes}>`;
    });

    return `data:image/svg+xml;base64,${Buffer.from(svgString).toString('base64')}`;
}

function addSlideWithBackground(pptx, backgroundPath) {
    const slide = pptx.addSlide();
    if (backgroundPath) {
        slide.background = { path: backgroundPath };
    }
    return slide;
}

function createTitleSlide(pptx, data, bgImagePath) {
    const slide = addSlideWithBackground(pptx, bgImagePath);
    slide.addText(data.examTitle, {
        x: 0.5, y: 1.5, w: '90%', h: 1, fontSize: 40, bold: true, color: '003B75', align: 'center',
    });
    const details = data.examDetails;
    const detailsText = `Total Questions: ${details.totalQuestions}  |  Time Allotted: ${details.timeAllotted}  |  Max Marks: ${details.maxMarks}`;
    slide.addText(detailsText, {
        x: 0.5, y: 3.0, w: '90%', h: 0.5, fontSize: 20, color: '333333', align: 'center',
    });
}

function createInstructionsSlide(pptx, data, bgImagePath) {
    const slide = addSlideWithBackground(pptx, bgImagePath);
    slide.addText(data.instructions.title, { x: 0.5, y: 0.5, w: '90%', fontSize: 32, bold: true, color: '2B6CB0' });
    const instructionPoints = data.instructions.points.map(point => ({ text: point, options: { fontSize: 18, bullet: true, paraSpcAfter: 10 } }));
    slide.addText(instructionPoints, {
        x: 0.75, y: 1.5, w: '85%', h: 3.5,
    });
}

function convertHtmlToPptxRichText(html) {
    if (!html) return [{ text: '' }];
    
    let textWithNewlines = html
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<p[^>]*>/gi, '')
        .replace(/<li[^>]*>/gi, '• ')
        .replace(/<\/li>/gi, '\n')
        .replace(/<ul[^>]*>|<\/ul>/gi, '')
        .replace(/<ol[^>]*>|<\/ol>/gi, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
    
    const parts = textWithNewlines.split(/(<\/?strong>|<\/?b>)/g);
    const richText = [];
    let isBold = false;
    
    parts.forEach(part => {
        if (part === '<strong>' || part === '<b>') {
            isBold = true;
        } else if (part === '</strong>' || part === '</b>') {
            isBold = false;
        } else if (part && part.trim()) {
            richText.push({ 
                text: part, 
                options: { 
                    bold: isBold,
                    fontSize: 11,
                    fontFace: 'Calibri'
                } 
            });
        }
    });
    
    return richText.length > 0 ? richText : [{ text: textWithNewlines }];
}

// --- MAIN PPT GENERATION FUNCTION FOR DATA INTERPRETATION ---

async function generatePptFromJson(jsonData, outputPath, backgroundPath) {
    try {
        console.log('Creating PowerPoint presentation for Data Interpretation...');

        const pptx = new PptxGenJS();

        // Create title and instructions slides
        createTitleSlide(pptx, jsonData, backgroundPath);
        createInstructionsSlide(pptx, jsonData, backgroundPath);

        // Process each question set
        jsonData.sections.forEach(section => {
            section.questionSets.forEach((questionSet, setIndex) => {
                // 1. Create a dedicated slide for the chart/data
                console.log(`Creating chart slide for question set ${setIndex + 1}...`);
                createChartSlide(pptx, questionSet, backgroundPath);

                // 2. Create a separate slide for each question
                questionSet.questions.forEach(question => {
                    console.log(`Creating slide for question ${question.questionNumber}...`);
                    createQuestionSlide(pptx, question, backgroundPath);
                });
            });
        });

        // Add answers divider slide
        const answerTitleSlide = addSlideWithBackground(pptx, backgroundPath);
        answerTitleSlide.addText('Answers & Solutions', {
            x: 0, y: '45%', w: '100%', align: 'center',
            fontSize: 44, color: '003B75', bold: true
        });

        // Create a separate slide for each answer
        jsonData.sections.forEach(section => {
            section.questionSets.forEach(questionSet => {
                questionSet.questions.forEach(question => {
                    console.log(`Creating answer slide for question ${question.questionNumber}...`);
                    createAnswerSlide(pptx, question, backgroundPath);
                });
            });
        });

        // Save the presentation
        await pptx.writeFile({ fileName: outputPath });
        console.log(`PowerPoint generated successfully: ${path.basename(outputPath)}`);

    } catch (error) {
        console.error(`PowerPoint generation failed: ${error.message}`);
        throw error;
    }
}

// --- PDF GENERATION FROM HTML ---
async function generatePdf(htmlContent, outputPath) {
    let browser = null;
    try {
        console.log('Launching browser for PDF generation...');
        browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        
        const page = await browser.newPage();
        await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
        
        const pdfBuffer = await page.pdf({
            format: 'A4',
            margin: {
                top: '20mm',
                right: '15mm',
                bottom: '20mm',
                left: '15mm'
            },
            printBackground: true,
            preferCSSPageSize: true,
            displayHeaderFooter: false
        });
        
        await fs.writeFile(outputPath, pdfBuffer);
        console.log(`PDF generated successfully: ${path.basename(outputPath)}`);
        
    } catch (error) {
        console.error('PDF generation failed:', error.message);
        throw error;
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

// --- API KEY MANAGER ---
class ApiKeyManager {
    constructor(apiKeys) {
        this.apiKeys = apiKeys.map(key => key.trim()).filter(key => key.length > 0);
        this.keyUsageCount = new Map();
        this.failedKeys = new Set();
        this.keyAssignments = new Map();
        this.keyLocks = new Map();
        
        this.apiKeys.forEach((key, index) => {
            this.keyUsageCount.set(index, 0);
            this.keyLocks.set(index, false);
        });
        
        console.log(`Loaded ${this.apiKeys.length} API keys for parallel usage`);
    }

    assignKeyToMock(mockNumber) {
        if (this.failedKeys.size === this.apiKeys.length) {
            throw new Error("All API keys have failed or exceeded quota");
        }
        
        let keyIndex = (mockNumber - 1) % this.apiKeys.length;
        let attempts = 0;
        
        while (this.failedKeys.has(keyIndex) && attempts < this.apiKeys.length) {
            keyIndex = (keyIndex + 1) % this.apiKeys.length;
            attempts++;
        }
        
        if (this.failedKeys.has(keyIndex)) {
            throw new Error("No available API keys");
        }
        
        this.keyAssignments.set(mockNumber, keyIndex);
        
        return {
            key: this.apiKeys[keyIndex],
            index: keyIndex
        };
    }

    getKeyForMock(mockNumber) {
        const keyIndex = this.keyAssignments.get(mockNumber);
        if (keyIndex === undefined) {
            throw new Error(`No key assigned to mock ${mockNumber}`);
        }
        
        if (this.failedKeys.has(keyIndex)) {
            console.log(`Reassigning key for mock ${mockNumber} (previous key failed)`);
            return this.assignKeyToMock(mockNumber);
        }
        
        return {
            key: this.apiKeys[keyIndex],
            index: keyIndex
        };
    }

    getNextAvailableKey(excludeIndex = -1) {
        if (this.failedKeys.size === this.apiKeys.length) {
            throw new Error("All API keys have failed or exceeded quota");
        }
        
        for (let i = 0; i < this.apiKeys.length; i++) {
            if (!this.failedKeys.has(i) && i !== excludeIndex) {
                return {
                    key: this.apiKeys[i],
                    index: i
                };
            }
        }
        
        throw new Error("No available API keys");
    }

    markKeyAsFailed(keyIndex, error) {
        this.failedKeys.add(keyIndex);
        console.warn(`API key ${keyIndex + 1} marked as failed: ${error.message}`);
        
        if (this.failedKeys.size < this.apiKeys.length) {
            console.log(`${this.apiKeys.length - this.failedKeys.size} API keys remaining`);
        }
        
        for (const [mockNumber, assignedKeyIndex] of this.keyAssignments.entries()) {
            if (assignedKeyIndex === keyIndex) {
                this.keyAssignments.delete(mockNumber);
            }
        }
    }

    incrementUsage(keyIndex) {
        const currentCount = this.keyUsageCount.get(keyIndex) || 0;
        this.keyUsageCount.set(keyIndex, currentCount + 1);
    }
}

let apiKeyManager = null;

// --- HELPER FUNCTIONS ---
function validateThinkingBudget(budget, model) {
    if (budget === undefined) return null;
    
    const budgetNum = parseInt(budget);
    
    if (budgetNum === -1) return -1;
    
    if (budgetNum === 0) {
        if (model.includes('pro')) {
            console.warn("Warning: Thinking cannot be disabled for Gemini Pro models. Using minimum budget (128) instead.");
            return 128;
        }
        return 0;
    }
    
    if (model.includes('flash-lite')) {
        if (budgetNum < 512 || budgetNum > 24576) {
            throw new Error(`Thinking budget for Flash-Lite must be between 512-24576 tokens, got ${budgetNum}`);
        }
    } else if (model.includes('flash')) {
        if (budgetNum < 1 || budgetNum > 24576) {
            throw new Error(`Thinking budget for Flash must be between 1-24576 tokens, got ${budgetNum}`);
        }
    } else if (model.includes('pro')) {
        if (budgetNum < 128 || budgetNum > 32768) {
            throw new Error(`Thinking budget for Pro must be between 128-32768 tokens, got ${budgetNum}`);
        }
    }
    
    return budgetNum;
}

function createGenerationConfig(options, model) {
    const config = {};
    
    if (options.maxTokens && options.maxTokens !== 8192) {
        config.maxOutputTokens = options.maxTokens;
    }
    
    if (options.temperature && options.temperature !== 0.8) {
        config.temperature = options.temperature;
    }
    
    const validatedBudget = validateThinkingBudget(options.thinkingBudget, model);
    if (validatedBudget !== null) {
        config.thinkingConfig = {
            thinkingBudget: validatedBudget
        };
        
        let budgetDesc;
        if (validatedBudget === -1) {
            budgetDesc = "dynamic (auto-adjusting)";
        } else if (validatedBudget === 0) {
            budgetDesc = "disabled";
        } else {
            budgetDesc = `${validatedBudget} tokens`;
        }
        console.log(`Thinking budget: ${budgetDesc}`);
    }
    
    return config;
}

// --- FILE UTILITIES ---
async function findPdfFiles(dirPath) {
    const pdfFiles = [];
    try {
        const files = await fs.readdir(dirPath, { withFileTypes: true });
        for (const file of files) {
            const fullPath = path.join(dirPath, file.name);
            if (file.isDirectory()) {
                pdfFiles.push(...(await findPdfFiles(fullPath)));
            } else if (path.extname(file.name).toLowerCase() === ".pdf") {
                pdfFiles.push(fullPath);
            }
        }
    } catch (error) {
        console.error(`Error: Failed to read directory '${dirPath}'. Please ensure it exists and you have permission to read it.`);
        throw error;
    }
    return pdfFiles;
}

async function getFileSize(filePath) {
    try {
        const stats = await fs.stat(filePath);
        return stats.size;
    } catch (error) {
        console.error(`Warning: Could not get file size for ${filePath}`);
        return 0;
    }
}

async function filesToGenerativeParts(filePaths, label) {
    const parts = [];
    const maxFileSize = 20 * 1024 * 1024; // 20MB limit
    
    for (const filePath of filePaths) {
        console.log(`- Processing ${label}: ${path.basename(filePath)}`);
        try {
            const fileSize = await getFileSize(filePath);
            if (fileSize > maxFileSize) {
                console.warn(`  - Warning: File ${path.basename(filePath)} is ${(fileSize / 1024 / 1024).toFixed(2)}MB, which exceeds the 20MB limit for inline data. Consider using the File API for larger files.`);
                continue;
            }
            
            const fileBuffer = await fs.readFile(filePath);
            parts.push({
                inlineData: {
                    mimeType: 'application/pdf',
                    data: fileBuffer.toString('base64'),
                },
            });
        } catch (error) {
            console.error(`  - Warning: Could not read file ${filePath}. Error: ${error.message}. It will be skipped.`);
        }
    }
    return parts;
}

function validateApiKey(apiKey) {
    const trimmedKey = apiKey.trim();
    if (!trimmedKey) {
        throw new Error("API key is empty");
    }
    if (trimmedKey.length < 10) {
        throw new Error("API key appears to be too short");
    }
    return trimmedKey;
}

async function validateDirectories(pyqDir, refMockDir) {
    try {
        await fs.access(pyqDir);
    } catch (error) {
        throw new Error(`PYQ directory '${pyqDir}' does not exist or is not accessible`);
    }
    
    try {
        await fs.access(refMockDir);
    } catch (error) {
        throw new Error(`Reference mock directory '${refMockDir}' does not exist or is not accessible`);
    }
}

function generateOutputFilename(baseOutput, mockNumber, totalMocks, extension = '.pdf') {
    const baseName = path.basename(baseOutput, path.extname(baseOutput));
    const dir = path.dirname(baseOutput);
    
    if (totalMocks === 1) {
        return path.join(dir, baseName + extension);
    }
    
    const paddedNumber = String(mockNumber).padStart(String(totalMocks).length, '0');
    const newFilename = `${baseName}_${paddedNumber}${extension}`;
    return path.join(dir, newFilename);
}

function generateDebugJsonFilename(baseOutput, mockNumber, totalMocks) {
    const baseName = path.basename(baseOutput, path.extname(baseOutput));
    const dir = path.dirname(baseOutput);

    if (totalMocks === 1) {
        return path.join(dir, `${baseName}_debug.json`);
    }

    const paddedNumber = String(mockNumber).padStart(String(totalMocks).length, '0');
    return path.join(dir, `${baseName}_${paddedNumber}_debug.json`);
}

function generateDebugHtmlFilename(baseOutput, mockNumber, totalMocks) {
    const baseName = path.basename(baseOutput, path.extname(baseOutput));
    const dir = path.dirname(baseOutput);

    if (totalMocks === 1) {
        return path.join(dir, `${baseName}_debug.html`);
    }

    const paddedNumber = String(mockNumber).padStart(String(totalMocks).length, '0');
    return path.join(dir, `${baseName}_${paddedNumber}_debug.html`);
}

// --- MAIN MOCK GENERATION FUNCTION ---
async function generateSingleMock(contents, outputPath, mockNumber, totalMocks, options) {
    const maxRetries = 3;
    let lastError = null;
    let currentKeyInfo = null;

    try {
        currentKeyInfo = apiKeyManager.assignKeyToMock(mockNumber);
        console.log(`Mock ${mockNumber}/${totalMocks} assigned to API Key ${currentKeyInfo.index + 1}`);
    } catch (error) {
        console.error(`Could not assign API key to mock ${mockNumber}: ${error.message}`);
        return {
            success: false,
            error: error,
            outputPath: outputPath
        };
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            currentKeyInfo = apiKeyManager.getKeyForMock(mockNumber);
            const genAI = new GoogleGenAI({ apiKey: currentKeyInfo.key });
            
            console.log(`Mock ${mockNumber}/${totalMocks} - Attempt ${attempt}/${maxRetries} (API Key ${currentKeyInfo.index + 1})`);
            
            const generationConfig = createGenerationConfig(options, options.model);
            
            const requestParams = {
                model: options.model,
                contents: contents
            };
            
            if (Object.keys(generationConfig).length > 0) {
                requestParams.generationConfig = generationConfig;
            }
            
            if (options.rateLimitDelay && options.rateLimitDelay > 0) {
                const adjustedDelay = Math.max(100, options.rateLimitDelay / apiKeyManager.apiKeys.length);
                await new Promise(resolve => setTimeout(resolve, adjustedDelay));
            }
            
            const response = await genAI.models.generateContent(requestParams);
            
            if (!response || !response.text) {
                throw new Error("No response received from API");
            }
            
            const generatedJson = response.text;
            
            if (!generatedJson || generatedJson.trim().length === 0) {
                throw new Error("Empty response received from API");
            }

            if (response.usageMetadata) {
                const usage = response.usageMetadata;
                console.log(`Token usage (Key ${currentKeyInfo.index + 1}) - Input: ${usage.promptTokenCount || 'N/A'}, Output: ${usage.candidatesTokenCount || 'N/A'}, Thinking: ${usage.thoughtsTokenCount || 'N/A'}`);
            }

            let jsonData;
            try {
                let cleanJson = generatedJson.trim();
                if (cleanJson.startsWith('```json')) {
                    cleanJson = cleanJson.replace(/^```json\s*/, '').replace(/\s*```$/, '');
                } else if (cleanJson.startsWith('```')) {
                    cleanJson = cleanJson.replace(/^```\s*/, '').replace(/\s*```$/, '');
                }
                
                jsonData = JSON.parse(cleanJson);
            } catch (parseError) {
                throw new Error(`Failed to parse JSON response: ${parseError.message}`);
            }

            if (!jsonData.examTitle || !jsonData.examDetails || !jsonData.sections) {
                throw new Error("Invalid JSON structure - missing required fields");
            }

            const outputDir = path.dirname(outputPath);
            if (outputDir !== '.') {
                await fs.mkdir(outputDir, { recursive: true });
            }

            if (options.saveJson) {
                const debugJsonPath = generateDebugJsonFilename(options.output, mockNumber, totalMocks);
                try {
                    await fs.writeFile(debugJsonPath, JSON.stringify(jsonData, null, 2));
                    console.log(`[DEBUG] Raw JSON for mock ${mockNumber} saved to: ${debugJsonPath}`);
                } catch(e) {
                    console.error(`[DEBUG] Failed to save debug JSON file: ${e.message}`);
                }
            }

            console.log(`Converting JSON to HTML for mock ${mockNumber}...`);
            const htmlContent = convertJsonToHtml(jsonData);

            if (options.saveHtml) {
                const debugHtmlPath = generateDebugHtmlFilename(options.output, mockNumber, totalMocks);
                try {
                    await fs.writeFile(debugHtmlPath, htmlContent);
                    console.log(`[DEBUG] Generated HTML for mock ${mockNumber} saved to: ${debugHtmlPath}`);
                } catch(e) {
                    console.error(`[DEBUG] Failed to save debug HTML file: ${e.message}`);
                }
            }

            console.log(`Converting to PDF: ${path.basename(outputPath)}`);
            await generatePdf(htmlContent, outputPath);

            if (options.ppt) {
                const pptOutputPath = generateOutputFilename(options.output, mockNumber, totalMocks, '.pptx');
                const backgroundPath = options.pptBackground || null;
                await generatePptFromJson(jsonData, pptOutputPath, backgroundPath);
            }
            
            apiKeyManager.incrementUsage(currentKeyInfo.index);
            
            console.log(`Mock ${mockNumber}/${totalMocks} completed with API Key ${currentKeyInfo.index + 1}: ${path.basename(outputPath)}`);
            console.log(`Generated content length: ${generatedJson.length} characters`);
            
            return {
                success: true,
                outputPath: outputPath,
                contentLength: generatedJson.length,
                keyIndex: currentKeyInfo.index,
                usage: response.usageMetadata,
                mockNumber: mockNumber,
                jsonData: jsonData
            };

        } catch (error) {
            lastError = error;
            const isQuotaError = error.message.includes('quota') || 
                               error.message.includes('RESOURCE_EXHAUSTED') ||
                               error.message.includes('rate limit');
            
            if (isQuotaError && currentKeyInfo) {
                apiKeyManager.markKeyAsFailed(currentKeyInfo.index, error);
                
                try {
                    currentKeyInfo = apiKeyManager.getNextAvailableKey(currentKeyInfo.index);
                    apiKeyManager.keyAssignments.set(mockNumber, currentKeyInfo.index);
                    console.log(`Mock ${mockNumber} switched to API Key ${currentKeyInfo.index + 1} for retry`);
                    continue;
                } catch (keyError) {
                    console.error(`No alternative API keys available for mock ${mockNumber}`);
                    break;
                }
            }
            
            if (attempt === maxRetries) {
                console.error(`Mock ${mockNumber}/${totalMocks} failed after ${maxRetries} attempts`);
                break;
            }
            
            const waitTime = Math.pow(1.5, attempt - 1) * 500;
            console.log(`Waiting ${waitTime}ms before retry...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
    }

    return {
        success: false,
        error: lastError,
        outputPath: outputPath
    };
}
