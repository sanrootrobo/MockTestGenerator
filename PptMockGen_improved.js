// --- MAIN MOCK GENERATION FUNCTION (updated for JSON with font options) ---
async function generateSingleMock(contents, outputPath, mockNumber, totalMocks, options) {
    const maxRetries = 3;
    let lastError = null;
    let currentKeyInfo = null;

    // Assign a dedicated key to this mock
    try {
        currentKeyInfo = apiKeyManager.assignKeyToMock(mockNumber);
        console.log(`🔑 Mock ${mockNumber}/${totalMocks} assigned to API Key ${currentKeyInfo.index + 1}`);
    } catch (error) {
        console.error(`❌ Could not assign API key to mock ${mockNumber}: ${error.message}`);
        return {
            success: false,
            error: error,
            outputPath: outputPath
        };
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            // Get the assigned key for this mock
            currentKeyInfo = apiKeyManager.getKeyForMock(mockNumber);
            const genAI = new GoogleGenAI({ apiKey: currentKeyInfo.key });
            
            console.log(`🔄 Mock ${mockNumber}/${totalMocks} - Attempt ${attempt}/${maxRetries} (API Key ${currentKeyInfo.index + 1})`);
            
            // Create generation config with thinking budget
            const generationConfig = createGenerationConfig(options, options.model);
            
            // Prepare request parameters
            const requestParams = {
                model: options.model,
                contents: contents
            };
            
            // Add generation config if it has any settings
            if (Object.keys(generationConfig).length > 0) {
                requestParams.generationConfig = generationConfig;
            }
            
            // Add rate limiting delay
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

            // Log token usage if available
            if (response.usageMetadata) {
                const usage = response.usageMetadata;
                console.log(`📊 Token usage (Key ${currentKeyInfo.index + 1}) - Input: ${usage.promptTokenCount || 'N/A'}, Output: ${usage.candidatesTokenCount || 'N/A'}, Thinking: ${usage.thoughtsTokenCount || 'N/A'}`);
            }

            // Parse and validate JSON
            let jsonData;
            try {
                // Clean the response - remove any markdown formatting if present
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

            // Validate JSON structure
            if (!jsonData.examTitle || !jsonData.examDetails || !jsonData.sections) {
                throw new Error("Invalid JSON structure - missing required fields");
            }

            // Ensure output directory exists
            const outputDir = path.dirname(outputPath);
            if (outputDir !== '.') {
                await fs.mkdir(outputDir, { recursive: true });
            }

            // Prepare font options
            const fontOptions = {
                fontName: validateFontName(options.fontName),
                fontSize: validateFontSize(options.fontSize)
            };

            // Save debug JSON file if requested
            if (options.saveJson) {
                const debugJsonPath = generateDebugJsonFilename(options.output, mockNumber, totalMocks);
                try {
                    await fs.writeFile(debugJsonPath, JSON.stringify(jsonData, null, 2));
                    console.log(`[DEBUG] Raw JSON for mock ${mockNumber} saved to: ${debugJsonPath}`);
                } catch(e) {
                    console.error(`[DEBUG] Failed to save debug JSON file: ${e.message}`);
                }
            }

            // Convert JSON to HTML with enhanced font options
            console.log(`🔄 Converting JSON to HTML for mock ${mockNumber}...`);
            const htmlContent = convertJsonToHtml(jsonData, fontOptions);

            // Save debug HTML file if requested
            if (options.saveHtml) {
                const debugHtmlPath = generateDebugHtmlFilename(options.output, mockNumber, totalMocks);
                try {
                    await fs.writeFile(debugHtmlPath, htmlContent);
                    console.log(`[DEBUG] Generated HTML for mock ${mockNumber} saved to: ${debugHtmlPath}`);
                } catch(e) {
                    console.error(`[DEBUG] Failed to save debug HTML file: ${e.message}`);
                }
            }

            // Generate PDF with enhanced quality
            console.log(`📄 Converting to PDF: ${path.basename(outputPath)}`);
            await generatePdf(htmlContent, outputPath, fontOptions);

            // Generate PPT if requested with enhanced font options
            if (options.ppt) {
                const pptOutputPath = generateOutputFilename(options.output, mockNumber, totalMocks, '.pptx');
                const backgroundPath = options.pptBackground || null;
                await generatePptFromJson(jsonData, pptOutputPath, backgroundPath, fontOptions);
            }
            
            // Update usage stats
            apiKeyManager.incrementUsage(currentKeyInfo.index);
            
            console.log(`✅ Mock ${mockNumber}/${totalMocks} completed with API Key ${currentKeyInfo.index + 1}: ${path.basename(outputPath)}`);
            console.log(`📄 Generated content length: ${generatedJson.length} characters`);
            console.log(`🎨 Font settings: ${fontOptions.fontName} - Questions/Answers: ${fontOptions.fontSize}pt, Titles: Fixed Large`);
            
            return {
                success: true,
                outputPath: outputPath,
                contentLength: generatedJson.length,
                keyIndex: currentKeyInfo.index,
                usage: response.usageMetadata,
                mockNumber: mockNumber,
                jsonData: jsonData,
                fontOptions: fontOptions
            };

        } catch (error) {
            lastError = error;
            const isQuotaError = error.message.includes('quota') || 
                               error.message.includes('RESOURCE_EXHAUSTED') ||
                               error.message.includes('rate limit');
            
            if (isQuotaError && currentKeyInfo) {
                apiKeyManager.markKeyAsFailed(currentKeyInfo.index, error);
                
                // Try to get a different available key for retry
                try {
                    currentKeyInfo = apiKeyManager.getNextAvailableKey(currentKeyInfo.index);
                    apiKeyManager.keyAssignments.set(mockNumber, currentKeyInfo.index);
                    console.log(`🔄 Mock ${mockNumber} switched to API Key ${currentKeyInfo.index + 1} for retry`);
                    continue;
                } catch (keyError) {
                    console.error(`❌ No alternative API keys available for mock ${mockNumber}`);
                    break;
                }
            }
            
            if (attempt === maxRetries) {
                console.error(`❌ Mock ${mockNumber}/${totalMocks} failed after ${maxRetries} attempts`);
                break;
            }
            
            // Wait before retrying
            const waitTime = Math.pow(1.5, attempt - 1) * 500;
            console.log(`⏳ Waiting ${waitTime}ms before retry...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
    }

    return {
        success: false,
        error: lastError,
        outputPath: outputPath
    };
}

// --- MAIN EXECUTION LOGIC ---
async function main() {
    program
        .requiredOption("--pyq <dir>", "Directory containing previous year question PDFs")
        .requiredOption("--reference-mock <dir>", "Directory containing reference mock PDFs")
        .requiredOption("-o, --output <filename>", "Base output filename for generated files")
        .requiredOption("--prompt <file>", "Path to user prompt file containing specific instructions for the mock test")
        .option("--api-key-file <file>", "Optional: Path to API key file (default: api_key.txt)")
        .option("--number-of-mocks <number>", "Number of mock tests to generate (default: 1)", "1")
        .option("--max-tokens <number>", "Maximum output tokens per request (default: 8192)", parseInt, 8192)
        .option("--temperature <number>", "Temperature for response generation (0.0-2.0, default: 0.7)", parseFloat, 0.7)
        .option("--concurrent-limit <number>", "Maximum concurrent API requests (default: 3)", parseInt, 3)
        .option("--rate-limit-delay <number>", "Delay between API requests in ms (default: 1000)", parseInt, 1000)
        .option("--thinking-budget <number>", "Thinking budget tokens for internal reasoning. Use -1 for dynamic, 0 to disable, or specific number (Flash: 1-24576, Flash-Lite: 512-24576, Pro: 128-32768)")
        .option("--model <model>", "Gemini model to use (default: gemini-2.5-flash)", "gemini-2.5-flash")
        .option("--ppt", "Generate a PowerPoint (.pptx) file from the JSON data")
        .option("--ppt-background <file>", "Background image file for PowerPoint slides")
        .option("--save-json", "Save the raw generated JSON to a debug file")
        .option("--save-html", "Save the generated HTML to a debug file")
        .option("--fontname <name>", "Font name for questions/answers (titles remain large). Ensure font is available on the system.", "Arial")
        .option("--fontsize <size>", "Font size in points for questions/answers only (6-54, default: 11). Titles use fixed large sizes.", parseFloat, 11)
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

    // Validate and set font options
    const validatedFontName = validateFontName(options.fontname);
    const validatedFontSize = validateFontSize(options.fontsize);
    
    // Update options with validated font settings
    options.fontName = validatedFontName;
    options.fontSize = validatedFontSize;

    // Check for Puppeteer
    try {
        await import('puppeteer');
        console.log('✅ Puppeteer available - PDF generation is enabled.');
    } catch (error) {
        console.error('❌ Puppeteer is required for PDF generation but is not installed.');
        console.error('Please install it with: npm install puppeteer');
        process.exit(1);
    }

    // Check for PptxGenJS if PPT is requested
    if (options.ppt) {
        try {
            await import('pptxgenjs');
            console.log('✅ PptxGenJS available - PowerPoint generation is enabled.');
        } catch (error) {
            console.error('❌ PptxGenJS is required for PowerPoint generation but is not installed.');
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
            console.log(`📝 Using user prompt from: ${options.prompt}`);
        } catch (error) {
            console.error(`\nError reading prompt file '${options.prompt}': ${error.message}`);
            process.exit(1);
        }

        if (!userPrompt.trim()) {
            console.error("Error: Prompt file is empty.");
            process.exit(1);
        }

        // 4. Process PDF Files
        console.log("\nProcessing input files...");
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
            { text: "--- USER INSTRUCTIONS ---" },
            { text: userPrompt }
        ];

        // 6. Generate mock tests
        console.log(`\n🚀 Starting generation of ${numberOfMocks} mock test(s)...`);
        let outputFormats = ["JSON", "PDF"];
        if (options.ppt) outputFormats.push("PowerPoint");
        console.log(`📄 Output Formats: ${outputFormats.join(', ')}`);
        console.log(`🎨 Typography: ${validatedFontName} font - Questions/Answers: ${validatedFontSize}pt, Titles: Fixed Large`);
        console.log(`🔧 Enhanced Features: High-quality diagrams, improved font hierarchy`);
        if (options.saveJson) {
            console.log("💾 Debug JSON files will be saved.");
        }
        if (options.saveHtml) {
            console.log("💾 Debug HTML files will be saved.");
        }
        
        const startTime = Date.now();
        
        const generationTasks = [];
        for (let i = 1; i <= numberOfMocks; i++) {
            const outputPath = generateOutputFilename(options.output, i, numberOfMocks, '.pdf');
            // Wrap in an anonymous function to delay execution
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

        console.log(`\n📈 Generation Summary:`);
        console.log(`✅ Successful: ${successful.length}/${numberOfMocks}`);
        console.log(`❌ Failed: ${failed.length}/${numberOfMocks}`);
        console.log(`⏱️  Total time: ${totalTime.toFixed(2)} seconds`);
        
        if (successful.length > 0) {
            console.log(`\n📁 Generated Files:`);
            successful.sort((a,b) => a.mockNumber - b.mockNumber).forEach(mockResult => {
                console.log(`  📄 ${path.basename(mockResult.outputPath)} (${mockResult.contentLength} chars, API Key ${mockResult.keyIndex + 1})`);
                if (options.ppt) {
                    const pptOutputPath = generateOutputFilename(options.output, mockResult.mockNumber, numberOfMocks, '.pptx');
                    console.log(`  📊 ${path.basename(pptOutputPath)}`);
                }
                if (options.saveJson) {
                    const debugJsonPath = generateDebugJsonFilename(options.output, mockResult.mockNumber, numberOfMocks);
                    console.log(`  💾 ${path.basename(debugJsonPath)}`);
                }
                if (options.saveHtml) {
                    const debugHtmlPath = generateDebugHtmlFilename(options.output, mockResult.mockNumber, numberOfMocks);
                    console.log(`  💾 ${path.basename(debugHtmlPath)}`);
                }
            });
            
            console.log(`\n🎨 Typography Settings Applied:`);
            console.log(`  Font Family: ${validatedFontName}`);
            console.log(`  Question/Answer Size: ${validatedFontSize}pt`);
            console.log(`  Title Sizes: Fixed Large (24pt headers, 20pt sub-headers, 18pt sections)`);
            console.log(`  Diagram Quality: Enhanced with high-resolution rendering`);
        }

        if (failed.length > 0) {
            console.log(`\n⚠️  Failed generations:`);
            failed.forEach((result, i) => {
                const error = result.reason || result.value?.error;
                const outputPath = result.value?.outputPath || `Task for mock ${i+1}`;
                console.log(`  - Mock for ${path.basename(outputPath)}: ${error?.message || 'Unknown error'}`);
            });
        }

        if (successful.length === 0) {
            console.error("\n❌ All mock test generations failed!");
            process.exit(1);
        }

        console.log(`\n🎉 Successfully generated ${successful.length} mock test(s) with enhanced quality!`);
        console.log(`📊 Key Improvements:`);
        console.log(`  • High-quality SVG diagrams with professional styling`);
        console.log(`  • Improved font hierarchy (large titles, user-controlled content)`);
        console.log(`  • Enhanced PDF/PowerPoint rendering quality`);
        console.log(`  • Better diagram positioning and clarity`);

    } catch (error) {
        console.error("\n❌ An unexpected error occurred:");
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
});


import { GoogleGenAI } from "@google/genai";
import { program } from "commander";
import * as fs from "fs/promises";
import * as path from "path";
import puppeteer from "puppeteer";
import PptxGenJS from 'pptxgenjs';

// --- ENHANCED SYSTEM PROMPT FOR HIGH-QUALITY DIAGRAMS ---

const systemPrompt = `You are an expert exam designer and question creator specializing in competitive entrance exams. Your primary task is to generate a BRAND NEW, high-quality mock test and output it as a single, complete, and valid JSON object.

Follow these rules with absolute precision:

1.  **Analyze Reference Materials:**
   *   Carefully study all the provided "REFERENCE PYQ PDF" documents to understand question styles, common topics, difficulty level, and typical phrasing.
   *   Examine the "REFERENCE Mock Test PDF" documents to understand their structure and the tone of their instructions.

2.  **Generate Original Content:**
   *   You MUST NOT copy any questions or passages directly from the reference materials.
   *   All questions, options, and solutions you generate must be entirely new and unique.

3.  **Process User Instructions:**
   *   The user will provide specific instructions for the mock test.
   *   Follow the user's requirements exactly regarding number of questions, topics, difficulty, exam format, etc.
   *   Prioritize user instructions over reference material patterns if they conflict.

4.  **Format as a Single, Complete JSON Object:**
   *   The ENTIRE output MUST be a single JSON object. Do not wrap it in any formatting or add any text outside the JSON structure.
   *   CRITICAL: To avoid JSON parsing errors, prefer plain text formatting in explanations over HTML tags. Use line breaks (\\n) and clear text structure instead of HTML formatting.
   *   Keep ALL strings SHORT (under 300 characters each) to prevent truncation during streaming.
   *   The JSON object must strictly adhere to the following schema:

   {
     "examTitle": "String",
     "examDetails": {
       "totalQuestions": Number,
       "timeAllotted": "String",
       "maxMarks": Number
     },
     "instructions": {
       "title": "String",
       "points": ["String", "String"]
     },
     "sections": [
       {
         "sectionTitle": "String",
         "questionSets": [
           {
             "type": "group | single",
             "directions": {
               "title": "String",
               "text": "String"
             },
             "questions": [
               {
                 "questionNumber": "String",
                 "questionText": "String",
                 "svg": "String | null",
                 "options": [
                   {
                     "label": "String",
                     "text": "String",
                     "svg": "String | null"
                   }
                 ],
                 "solution": {
                   "answer": "String",
                   "explanation": "String",
                   "svg": "String | null"
                 }
               }
             ]
           }
         ]
       }
     ]
   }

5.  **HIGH-QUALITY DIAGRAM GENERATION (SVG):**
   *   For any question, option, or solution requiring a diagram, you MUST provide a clear, well-labeled, professional diagram.
   *   All diagrams must be drawn using **inline SVG** with these quality standards:
     - Use proper coordinate systems with adequate spacing and margins
     - Apply consistent stroke widths (minimum 2px for visibility)
     - Use high-contrast colors (black #000000 for lines, dark blue #003366 for text)
     - Include clear, readable labels with appropriate font sizes (minimum 12px)
     - Add proper geometric spacing and alignment
     - Use grid-based positioning for technical accuracy
     - Include proper scaling and proportions
     - Add background rectangles or borders when needed for clarity
     - Use mathematical precision for geometric shapes
   *   Escape SVG properly: replace < with \\u003c and > with \\u003e in JSON.
   *   Ensure SVG is valid and renders correctly at various sizes.
   *   Example of high-quality SVG structure:
     \\u003csvg width="400" height="300" viewBox="0 0 400 300" xmlns="http://www.w3.org/2000/svg"\\u003e
       \\u003crect width="400" height="300" fill="#f8f9fa" stroke="#dee2e6" stroke-width="2"/\\u003e
       \\u003cg transform="translate(50,50)"\\u003e
         \\u003cline x1="0" y1="0" x2="200" y2="0" stroke="#000000" stroke-width="3"/\\u003e
         \\u003ctext x="100" y="-10" text-anchor="middle" font-family="Arial" font-size="14" fill="#003366"\\u003eLabel\\u003c/text\\u003e
       \\u003c/g\\u003e
     \\u003c/svg\\u003e

6.  **Content Rules:**
   *   Ensure every question has a corresponding solution with a clear answer and explanation.
   *   The questionNumber for each question must be unique.
   *   Generate content based on the user prompt and reference materials, ensuring it is logical, solvable, and free of contradictions.
   *   Keep explanations comprehensive but under 250 characters for streaming safety.
   *   Create realistic distractors that test conceptual understanding.
   *   Maintain authentic competitive exam standards and complexity found in reference materials.

7.  **String Safety Rules:**
   *   Avoid nested quotes - use single quotes inside strings or remove quotes entirely.
   *   No line breaks in strings - use spaces instead.
   *   Minimize special symbols that require escaping.
   *   Keep sentences clear and concise.
   *   Use basic punctuation only (periods, commas).

Generate the complete mock test following this format exactly.`;


// --- ENHANCED HTML CONVERSION WITH IMPROVED FONT HIERARCHY ---
function convertJsonToHtml(jsonData, fontOptions = {}) {
    // Default font settings
    const { fontName = 'Arial', fontSize = 11 } = fontOptions;
    
    // FIXED LARGE SIZES for titles and headings (independent of user font size)
    const headerFontSize = 24;           // Fixed large title size
    const subHeaderFontSize = 20;        // Fixed large sub-header size  
    const sectionTitleFontSize = 18;     // Fixed large section title size
    const instructionTitleFontSize = 16; // Fixed instruction title size
    
    // USER-CONTROLLED SIZES for questions and answers
    const baseFontSize = fontSize;                    // User-specified base size
    const questionNumberFontSize = baseFontSize * 1.1; // Slightly larger for question numbers
    const answerKeyFontSize = baseFontSize * 1.05;   // Slightly larger for answer keys
    const optionFontSize = baseFontSize * 0.95;      // Slightly smaller for options
    const instructionFontSize = baseFontSize;        // Same as base for instructions
    const questionTextFontSize = baseFontSize;       // Same as base for question text
    
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${jsonData.examTitle}</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=${fontName.replace(/\s+/g, '+')}:wght@300;400;500;600;700&display=swap');
        
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: '${fontName}', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6;
            color: #2d3748;
            background-color: #ffffff;
            font-size: ${baseFontSize}pt;
            max-width: none;
            margin: 0;
            padding: 20px;
        }
        
        /* Header Styling - FIXED LARGE SIZES */
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
            font-size: ${headerFontSize}pt;
            font-weight: 700;
            margin-bottom: 8px;
            border: none;
        }
        
        .test-info {
            display: flex;
            justify-content: space-around;
            margin-top: 16px;
            font-size: ${subHeaderFontSize * 0.7}pt;
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
            font-size: ${subHeaderFontSize * 0.8}pt;
        }
        
        /* Instructions - FIXED TITLE, USER-CONTROLLED CONTENT */
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
            font-size: ${instructionTitleFontSize}pt;
            font-weight: 600;
            margin: 0 0 12px 0;
        }
        
        .instructions ul {
            list-style-type: disc;
            margin-left: 20px;
        }
        
        .instructions li {
            margin: 8px 0;
            font-size: ${instructionFontSize}pt;
        }
        
        /* Section Headers - FIXED LARGE SIZES */
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
            font-size: ${sectionTitleFontSize}pt;
            font-weight: 600;
            color: #495057;
            margin: 0;
        }
        
        /* Directions - USER-CONTROLLED */
        .directions {
            background: #f0f9ff;
            border: 1px solid #bae6fd;
            border-radius: 6px;
            padding: 12px;
            margin: 16px 0;
            font-style: italic;
            color: #0c4a6e;
            font-size: ${instructionFontSize}pt;
        }
        
        .directions-title {
            font-weight: 600;
            margin-bottom: 8px;
            font-size: ${instructionFontSize * 1.1}pt;
        }
        
        /* Questions - USER-CONTROLLED */
        .question {
            background: #f7fafc;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 16px;
            margin: 16px 0;
            page-break-inside: avoid;
        }
        
        .question-number {
            font-weight: 600;
            color: #2b6cb0;
            font-size: ${questionNumberFontSize}pt;
        }
        
        .question-text {
            margin: 8px 0 12px 0;
            font-size: ${questionTextFontSize}pt;
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
            font-size: ${optionFontSize}pt;
        }
        
        /* Enhanced SVG Container for Better Diagram Display */
        .svg-container {
            display: flex;
            justify-content: center;
            align-items: center;
            margin: 16px 0;
            padding: 12px;
            background: #ffffff;
            border: 2px solid #e2e8f0;
            border-radius: 8px;
            page-break-inside: avoid;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        
        .svg-container svg {
            max-width: 100%;
            height: auto;
            background: #ffffff;
            border-radius: 4px;
        }
        
        /* Answer Section - FIXED TITLE, USER-CONTROLLED CONTENT */
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
            font-size: ${subHeaderFontSize}pt;
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
            font-size: ${answerKeyFontSize}pt;
            margin-bottom: 8px;
        }
        
        .answer-explanation {
            color: #2f855a;
            font-size: ${baseFontSize}pt;
            line-height: 1.5;
        }
        
        /* Print Optimizations */
        @media print {
            body {
                padding: 10px;
            }
            
            .question {
                margin: 12px 0;
                padding: 12px;
            }
            
            .answer-solutions {
                margin: 24px 0;
                padding: 16px;
            }
            
            .svg-container {
                break-inside: avoid;
                page-break-inside: avoid;
            }
        }
        
        /* Responsive Design */
        @media screen and (max-width: 768px) {
            body {
                padding: 10px;
            }
            
            .test-info {
                flex-direction: column;
                gap: 10px;
            }
            
            .svg-container {
                padding: 8px;
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
            ${questionSet.type === 'group' && questionSet.directions ? `
                <div class="directions">
                    <div class="directions-title">${questionSet.directions.title}</div>
                    <div>${questionSet.directions.text}</div>
                </div>
            ` : ''}
            
            ${questionSet.questions.map(question => `
                <div class="question">
                    <span class="question-number">${question.questionNumber}.</span>
                    <div class="question-text">${question.questionText}</div>
                    
                    ${question.svg ? `
                        <div class="svg-container">
                            ${question.svg}
                        </div>
                    ` : ''}
                    
                    <div class="options">
                        ${question.options.map(option => `
                            <div class="option">
                                <strong>${option.label})</strong> ${option.text || ''}
                                ${option.svg ? `
                                    <div class="svg-container">
                                        ${option.svg}
                                    </div>
                                ` : ''}
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
                        <div class="answer-explanation">${question.solution.explanation}</div>
                        ${question.solution.svg ? `
                            <div class="svg-container">
                                ${question.solution.svg}
                            </div>
                        ` : ''}
                    </div>
                `).join('')
            ).join('')
        ).join('')}
    </div>
</body>
</html>`;

    return html;
}

// --- ENHANCED SVG TO PNG CONVERSION WITH BETTER QUALITY ---
async function svgToPngBase64(svgContent, width = 800, height = 600) {
    if (!svgContent || !svgContent.includes('<svg')) return null;

    let browser = null;
    try {
        browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        });
        const page = await browser.newPage();
        
        // Set higher resolution for better quality
        await page.setViewport({ width: width, height: height, deviceScaleFactor: 2 });
        
        // Enhanced HTML template for better SVG rendering
        const htmlTemplate = `<!DOCTYPE html>
<html>
<head>
<style>
  body, html { 
    margin: 0; 
    padding: 20px; 
    background: transparent; 
    font-family: Arial, sans-serif;
  }
  svg { 
    display: block; 
    margin: 0 auto;
    background: white;
    border: 1px solid #e2e8f0;
    border-radius: 4px;
  }
</style>
</head>
<body>${svgContent}</body>
</html>`;

        await page.setContent(htmlTemplate, { waitUntil: 'networkidle0' });

        const svgElement = await page.$('svg');
        if (!svgElement) {
            throw new Error('SVG element not found on page');
        }

        // Get higher quality screenshot
        const buffer = await svgElement.screenshot({
            encoding: 'base64',
            omitBackground: false,
            type: 'png',
            quality: 100
        });
        
        return `data:image/png;base64,${buffer}`;
    } catch (error) {
        console.error(`❌ Failed to convert SVG to PNG: ${error.message}`);
        return null;
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

// --- ENHANCED POWERPOINT GENERATION WITH BETTER FONT HIERARCHY ---
function addSlideWithBackground(pptx, backgroundPath) {
    const slide = pptx.addSlide();
    if (backgroundPath) {
        slide.background = { path: backgroundPath };
    }
    return slide;
}

function createTitleSlide(pptx, data, bgImagePath, fontOptions = {}) {
    const { fontName = 'Arial', fontSize = 11 } = fontOptions;
    const slide = addSlideWithBackground(pptx, bgImagePath);
    
    // Title uses FIXED large size (independent of user font size)
    slide.addText(data.examTitle, {
        x: 0.5, y: 1.5, w: '90%', h: 1, 
        fontSize: 28,  // FIXED large title size
        bold: true, color: '003B75', align: 'center',
        fontFace: fontName
    });
    
    const details = data.examDetails;
    const detailsText = `Total Questions: ${details.totalQuestions}  |  Time Allotted: ${details.timeAllotted}  |  Max Marks: ${details.maxMarks}`;
    slide.addText(detailsText, {
        x: 0.5, y: 3.0, w: '90%', h: 0.5, 
        fontSize: 16,  // FIXED moderate size for details
        color: '333333', align: 'center',
        fontFace: fontName
    });
}

function createInstructionsSlide(pptx, data, bgImagePath, fontOptions = {}) {
    const { fontName = 'Arial', fontSize = 11 } = fontOptions;
    const slide = addSlideWithBackground(pptx, bgImagePath);
    
    // Title uses FIXED large size
    slide.addText(data.instructions.title, { 
        x: 0.5, y: 0.5, w: '90%', 
        fontSize: 22,  // FIXED large title size
        bold: true, color: '2B6CB0',
        fontFace: fontName
    });
    
    // Instruction content uses USER-CONTROLLED size
    const instructionPoints = data.instructions.points.map(point => ({ 
        text: point, 
        options: { 
            fontSize: Math.round(fontSize),  // USER-CONTROLLED
            bullet: true, 
            paraSpcAfter: 10,
            fontFace: fontName
        } 
    }));
    
    slide.addText(instructionPoints, {
        x: 0.75, y: 1.5, w: '85%', h: 3.5,
    });
}

async function createQuestionSlide(pptx, question, directions, bgImagePath, fontOptions = {}) {
    const { fontName = 'Arial', fontSize = 11 } = fontOptions;
    const slide = addSlideWithBackground(pptx, bgImagePath);
    
    // Question number uses FIXED large size
    slide.addText(`Question ${question.questionNumber}`, { 
        x: 0.5, y: 0.4, w: '90%', 
        fontSize: 20,  // FIXED large size for question header
        bold: true, color: '1A365D',
        fontFace: fontName
    });

    let currentY = 1.0;
    if (directions) {
        const cleanDirections = directions.text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        slide.addText(`Directions: ${cleanDirections}`, {
            x: 0.5, y: currentY, w: '90%', h: 1.5,
            fontSize: Math.round(fontSize),  // USER-CONTROLLED
            italic: true, color: '555555', fill: { color: 'E2E8F0' }, margin: 10,
            fontFace: fontName
        });
        currentY += 1.7;
    }
    
    // Question text uses USER-CONTROLLED size
    const questionTextHeight = question.questionText.length > 200 ? 1.5 : 1;
    slide.addText(convertHtmlToPptxRichText(question.questionText), {
        x: 0.5, y: currentY, w: '90%', h: questionTextHeight, 
        fontSize: Math.round(fontSize),  // USER-CONTROLLED
        fontFace: fontName
    });
    currentY += questionTextHeight + 0.2;

    // Enhanced SVG handling
    if (question.svg) {
        const pngBase64 = await svgToPngBase64(question.svg, 800, 600);
        if (pngBase64) {
            slide.addImage({ data: pngBase64, x: 2.5, y: currentY, w: 5, h: 3 });
            currentY += 3.2;
        }
    }
    
    // Options use USER-CONTROLLED size
    for (const opt of question.options) {
        const optionText = `${opt.label}) ${opt.text || ''}`;
        if (opt.svg) {
            slide.addText(`${opt.label})`, { 
                x: 0.75, y: currentY, w: 0.5, h: 0.5, 
                fontSize: Math.round(fontSize * 0.9),  // USER-CONTROLLED
                fontFace: fontName
            });
            const pngBase64 = await svgToPngBase64(opt.svg, 400, 300);
            if (pngBase64) slide.addImage({ data: pngBase64, x: 1.25, y: currentY - 0.25, w: 2, h: 1.5 });
            currentY += 1.7;
        } else {
            slide.addText(optionText, { 
                x: 0.75, y: currentY, w: '85%', h: 0.3, 
                fontSize: Math.round(fontSize * 0.9),  // USER-CONTROLLED
                fontFace: fontName
            });
            currentY += 0.4;
        }
    }
}

async function createAnswerSlide(pptx, question, bgImagePath, fontOptions = {}) {
    const { fontName = 'Arial', fontSize = 11 } = fontOptions;
    const slide = addSlideWithBackground(pptx, bgImagePath);
    
    // Answer title uses FIXED large size
    slide.addText(`Answer & Solution: Q${question.questionNumber}`, { 
        x: 0.5, y: 0.4, w: '90%', 
        fontSize: 20,  // FIXED large size
        bold: true, color: '1A365D',
        fontFace: fontName
    });

    // Answer key uses USER-CONTROLLED size (slightly larger)
    slide.addText(question.solution.answer, {
        x: 0.5, y: 1.0, w: '90%', h: 0.4,
        fontSize: Math.round(fontSize * 1.2),  // USER-CONTROLLED
        bold: true, color: '008000',
        fontFace: fontName
    });
    
    const explanationText = question.solution.explanation.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    
    // Enhanced SVG handling for solutions
    const pngBase64 = await svgToPngBase64(question.solution.svg, 800, 600);
    
    // Explanation uses USER-CONTROLLED size
    slide.addText(explanationText, {
        x: 0.5, y: 1.6, w: pngBase64 ? '50%' : '90%', h: 3.8, 
        fontSize: Math.round(fontSize),  // USER-CONTROLLED
        fontFace: fontName
    });
    
    if (pngBase64) {
        slide.addImage({ data: pngBase64, x: 5.0, y: 1.8, w: 4.5, h: 3.5 });
    }
}

// --- REST OF THE CODE REMAINS THE SAME ---

function convertHtmlToPptxRichText(html) {
    if (!html) return [{ text: '' }];
    const textWithNewlines = html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/?p>/gi, '');
    const parts = textWithNewlines.split(/(<\/?strong>)/g);
    const richText = [];
    let isBold = false;
    parts.forEach(part => {
        if (part === '<strong>') isBold = true;
        else if (part === '</strong>') isBold = false;
        else if (part) richText.push({ text: part, options: { bold: isBold } });
    });
    return richText.length > 0 ? richText : [{ text: textWithNewlines }];
}

async function generatePptFromJson(jsonData, outputPath, backgroundPath, fontOptions = {}) {
    try {
        console.log('📊 Creating PowerPoint presentation...');
        
        const pptx = new PptxGenJS();
        
        createTitleSlide(pptx, jsonData, backgroundPath, fontOptions);
        createInstructionsSlide(pptx, jsonData, backgroundPath, fontOptions);

        const allQuestions = [];
        jsonData.sections.forEach(section => {
            section.questionSets.forEach(qSet => {
                const directions = qSet.type === 'group' ? qSet.directions : null;
                qSet.questions.forEach(q => allQuestions.push({ ...q, directions }));
            });
        });

        console.log('📝 Creating question slides...');
        for (const q of allQuestions) {
            await createQuestionSlide(pptx, q, q.directions, backgroundPath, fontOptions);
        }

        const answerTitleSlide = addSlideWithBackground(pptx, backgroundPath);
        answerTitleSlide.addText('Answers & Solutions', { 
            x: 0, y: '45%', w: '100%', align: 'center', 
            fontSize: 24,  // FIXED large title size
            color: '003B75', bold: true,
            fontFace: fontOptions.fontName || 'Arial'
        });

        console.log('✅ Creating answer slides...');
        for (const q of allQuestions) {
            await createAnswerSlide(pptx, q, backgroundPath, fontOptions);
        }

        await pptx.writeFile({ fileName: outputPath });
        console.log(`📊 PowerPoint generated successfully: ${path.basename(outputPath)}`);
        
    } catch (error) {
        console.error(`❌ PowerPoint generation failed: ${error.message}`);
        throw error;
    }
}

// --- ENHANCED PDF GENERATION FROM HTML WITH FONT OPTIONS ---
async function generatePdf(htmlContent, outputPath, fontOptions = {}) {
    let browser = null;
    try {
        console.log('📄 Launching browser for PDF generation...');
        browser = await puppeteer.launch({
            headless: 'new',
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--disable-features=VizDisplayCompositor'
            ]
        });
        
        const page = await browser.newPage();
        
        // Set higher resolution for better quality
        await page.setViewport({ width: 1200, height: 1600, deviceScaleFactor: 2 });
        
        await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
        
        // Wait for fonts to load
        await page.evaluateHandle('document.fonts.ready');
        
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
        console.log(`📄 PDF generated successfully: ${path.basename(outputPath)}`);
        
    } catch (error) {
        console.error('❌ PDF generation failed:', error.message);
        throw error;
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

// --- API KEY MANAGER (unchanged) ---
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
        
        console.log(`📋 Loaded ${this.apiKeys.length} API keys for parallel usage`);
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
            console.log(`🔄 Reassigning key for mock ${mockNumber} (previous key failed)`);
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
        console.warn(`⚠️  API key ${keyIndex + 1} marked as failed: ${error.message}`);
        
        if (this.failedKeys.size < this.apiKeys.length) {
            console.log(`🔄 ${this.apiKeys.length - this.failedKeys.size} API keys remaining`);
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

// --- HELPER FUNCTIONS (updated for JSON) ---
function validateThinkingBudget(budget, model) {
    if (budget === undefined) return null;
    
    const budgetNum = parseInt(budget);
    
    if (budgetNum === -1) return -1;
    
    if (budgetNum === 0) {
        if (model.includes('pro')) {
            console.warn("⚠️  Warning: Thinking cannot be disabled for Gemini Pro models. Using minimum budget (128) instead.");
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
    
    if (options.maxTokens && options.maxTokens !== 80192) {
        config.maxOutputTokens = options.maxTokens;
    }
    
    if (options.temperature && options.temperature !== 1) {
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
        console.log(`🧠 Thinking budget: ${budgetDesc}`);
    }
    
    return config;
}

// --- ENHANCED FONT VALIDATION FUNCTIONS ---
function validateFontName(fontName) {
    const defaultFont = 'Arial';
    if (!fontName || typeof fontName !== 'string' || !fontName.trim()) {
        console.log(`✅ No font specified. Using default: ${defaultFont}`);
        return defaultFont;
    }
    
    const sanitizedFont = fontName.trim();
    console.log(`✅ Using font: ${sanitizedFont}`);
    return sanitizedFont;
}

function validateFontSize(fontSize) {
    if (fontSize === undefined || fontSize === null) {
        return 11; // Default font size in points
    }
    
    const size = parseFloat(fontSize);
    
    if (isNaN(size)) {
        console.warn(`⚠️  Invalid font size '${fontSize}'. Using default: 11pt`);
        return 11;
    }
    
    if (size < 6) {
        console.warn(`⚠️  Font size ${size}pt is too small. Using minimum: 6pt`);
        return 6;
    }
    
    if (size > 54) {
        console.warn(`⚠️  Font size ${size}pt is too large. Using maximum: 54pt`);
        return 54;
    }
    
    console.log(`✅ Using font size: ${size}pt for questions and answers (titles remain large)`);
    return size;
}

// --- FILE UTILITIES (unchanged) ---
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
