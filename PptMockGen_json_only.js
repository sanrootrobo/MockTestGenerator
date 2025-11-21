import { GoogleGenAI } from "@google/genai";
import { program } from "commander";
import * as fs from "fs/promises";
import * as path from "path";

// --- SYSTEM PROMPT FOR JSON OUTPUT ---
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
    *   The ENTIRE output MUST be a single JSON object. Do not wrap it in markdown or add any text outside the JSON structure.
    *   The JSON object must strictly adhere to the following schema:
    \`\`\`json
    {
      "examTitle": "String", // The main title, e.g., "SRCC GBO Logical Reasoning Mock Test"
      "examDetails": {
        "totalQuestions": Number,
        "timeAllotted": "String", // e.g., "30 Minutes"
        "maxMarks": Number
      },
      "instructions": {
        "title": "String", // e.g., "Instructions"
        "points": ["String", "String", ...] // An array of instruction points
      },
      "sections": [
        {
          "sectionTitle": "String",
          "questionSets": [
            {
              "type": "group | single", // "group" if there are shared directions, "single" otherwise
              "directions": { // Optional: Only include if type is "group"
                "title": "String", // e.g., "Directions for questions 1 and 2:"
                "text": "String" // The directions text. Can include HTML like <br> or <ul>.
              },
              "questions": [
                {
                  "questionNumber": "String", // e.g., "Q1", "9"
                  "questionText": "String", // The question. Can include HTML like <strong> or <br>.
                  "svg": "String | null", // Optional: An inline SVG string for the question diagram.
                  "options": [
                    {
                      "label": "String", // "A", "B", etc.
                      "text": "String", // The option text.
                      "svg": "String | null" // Optional: An inline SVG for the option.
                    }
                  ],
                  "solution": {
                    "answer": "String", // e.g., "Option (D) – R"
                    "explanation": "String", // Detailed explanation. Can include HTML.
                    "svg": "String | null" // Optional: An inline SVG for the solution diagram.
                  }
                }
              ]
            }
          ]
        }
      ]
    }
    \`\`\`

5.  **Diagram Generation (SVG):**
    *   For any question, option, or solution requiring a diagram, you MUST provide a clear, well-labeled diagram.
    *   All diagrams must be drawn using **inline SVG** string elements embedded directly in the \`svg\` fields of the JSON. Ensure the SVG is a complete and valid string.

6.  **Content Rules:**
    *   Ensure every question has a corresponding solution with a clear answer and explanation.
    *   The \`questionNumber\` for each question must be unique.
    *   Generate content based on the user prompt and reference materials, ensuring it is logical, solvable, and free of contradictions.`;

// --- HELPER FUNCTIONS ---
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
    
    if (options.maxTokens && options.maxTokens !== 8192) {
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

// --- FIXED STREAMING JSON GENERATION ---
async function generateMockTestWithStreaming(contents, outputPath, options) {
    const maxRetries = 3;
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`🔄 Attempt ${attempt}/${maxRetries} - Starting JSON generation with streaming...`);
            
            const ai = new GoogleGenAI({ apiKey: options.apiKey });
            
            // Create generation config
            const generationConfig = createGenerationConfig(options, options.model);
            
            console.log("🚀 Starting stream generation...");
            console.log("📝 Generated JSON content:");
            console.log("=" .repeat(50));
            
            // Generate content with streaming using the correct API structure
            const requestParams = {
                model: options.model,
                contents: contents
            };
            
            // Add generation config if it has any settings
            if (Object.keys(generationConfig).length > 0) {
                requestParams.generationConfig = generationConfig;
            }
            
            const response = await ai.models.generateContentStream(requestParams);
            
            let fullResponse = '';
            let chunkCount = 0;
            
            // Stream the response - the response itself is iterable, not response.stream
            try {
                for await (const chunk of response) {
                    const chunkText = chunk.text;
                    if (chunkText) {
                        process.stdout.write(chunkText);
                        fullResponse += chunkText;
                        chunkCount++;
                    }
                }
            } catch (streamError) {
                console.error(`\n❌ Streaming error: ${streamError.message}`);
                throw streamError;
            }
            
            console.log("\n" + "=" .repeat(50));
            console.log(`📊 Streaming completed: ${chunkCount} chunks received`);
            
            if (!fullResponse || fullResponse.trim().length === 0) {
                throw new Error("Empty response received from API");
            }

            // Note: Usage metadata might not be available in streaming mode
            console.log(`📊 Token usage information not available in streaming mode`);

            // Parse and validate JSON
            let jsonData;
            try {
                // Clean the response - remove any markdown formatting if present
                let cleanJson = fullResponse.trim();
                if (cleanJson.startsWith('```json')) {
                    cleanJson = cleanJson.replace(/^```json\s*/, '').replace(/\s*```$/, '');
                } else if (cleanJson.startsWith('```')) {
                    cleanJson = cleanJson.replace(/^```\s*/, '').replace(/\s*```$/, '');
                }
                
                jsonData = JSON.parse(cleanJson);
                console.log("✅ JSON parsing successful!");
            } catch (parseError) {
                throw new Error(`Failed to parse JSON response: ${parseError.message}`);
            }

            // Validate JSON structure
            if (!jsonData.examTitle || !jsonData.examDetails || !jsonData.sections) {
                throw new Error("Invalid JSON structure - missing required fields");
            }

            console.log("✅ JSON structure validation passed!");

            // Save JSON to file
            const outputDir = path.dirname(outputPath);
            if (outputDir !== '.') {
                await fs.mkdir(outputDir, { recursive: true });
            }

            await fs.writeFile(outputPath, JSON.stringify(jsonData, null, 2));
            console.log(`💾 JSON saved to: ${outputPath}`);
            
            return {
                success: true,
                outputPath: outputPath,
                contentLength: fullResponse.length,
                usage: null, // Usage metadata not available in streaming mode
                jsonData: jsonData
            };

        } catch (error) {
            lastError = error;
            console.error(`❌ Attempt ${attempt} failed: ${error.message}`);
            
            if (attempt === maxRetries) {
                console.error(`❌ All ${maxRetries} attempts failed`);
                break;
            }
            
            // Wait before retrying
            const waitTime = Math.pow(1.5, attempt - 1) * 1000;
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

// --- FALLBACK NON-STREAMING GENERATION ---
async function generateMockTestWithoutStreaming(contents, outputPath, options) {
    const maxRetries = 3;
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`🔄 Attempt ${attempt}/${maxRetries} - Starting JSON generation (non-streaming)...`);
            
            const ai = new GoogleGenAI({ apiKey: options.apiKey });
            
            // Create generation config
            const generationConfig = createGenerationConfig(options, options.model);
            
            console.log("🚀 Starting content generation...");
            
            // Generate content without streaming using the correct API structure
            const requestParams = {
                model: options.model,
                contents: contents
            };
            
            // Add generation config if it has any settings
            if (Object.keys(generationConfig).length > 0) {
                requestParams.generationConfig = generationConfig;
            }
            
            const result = await ai.models.generateContent(requestParams);
            
            const fullResponse = result.text;
            
            if (!fullResponse || fullResponse.trim().length === 0) {
                throw new Error("Empty response received from API");
            }

            console.log("📝 Generated JSON content:");
            console.log("=" .repeat(50));
            console.log(fullResponse);
            console.log("=" .repeat(50));

            // Log token usage if available
            if (result.usageMetadata) {
                const usage = result.usageMetadata;
                console.log(`📊 Token usage - Input: ${usage.promptTokenCount || 'N/A'}, Output: ${usage.candidatesTokenCount || 'N/A'}, Thinking: ${usage.thoughtsTokenCount || 'N/A'}`);
            }

            // Parse and validate JSON
            let jsonData;
            try {
                // Clean the response - remove any markdown formatting if present
                let cleanJson = fullResponse.trim();
                if (cleanJson.startsWith('```json')) {
                    cleanJson = cleanJson.replace(/^```json\s*/, '').replace(/\s*```$/, '');
                } else if (cleanJson.startsWith('```')) {
                    cleanJson = cleanJson.replace(/^```\s*/, '').replace(/\s*```$/, '');
                }
                
                jsonData = JSON.parse(cleanJson);
                console.log("✅ JSON parsing successful!");
            } catch (parseError) {
                throw new Error(`Failed to parse JSON response: ${parseError.message}`);
            }

            // Validate JSON structure
            if (!jsonData.examTitle || !jsonData.examDetails || !jsonData.sections) {
                throw new Error("Invalid JSON structure - missing required fields");
            }

            console.log("✅ JSON structure validation passed!");

            // Save JSON to file
            const outputDir = path.dirname(outputPath);
            if (outputDir !== '.') {
                await fs.mkdir(outputDir, { recursive: true });
            }

            await fs.writeFile(outputPath, JSON.stringify(jsonData, null, 2));
            console.log(`💾 JSON saved to: ${outputPath}`);
            
            return {
                success: true,
                outputPath: outputPath,
                contentLength: fullResponse.length,
                usage: result.usageMetadata,
                jsonData: jsonData
            };

        } catch (error) {
            lastError = error;
            console.error(`❌ Attempt ${attempt} failed: ${error.message}`);
            
            if (attempt === maxRetries) {
                console.error(`❌ All ${maxRetries} attempts failed`);
                break;
            }
            
            // Wait before retrying
            const waitTime = Math.pow(1.5, attempt - 1) * 1000;
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

// --- MAIN EXECUTION ---
async function main() {
    program
        .requiredOption("--pyq <dir>", "Directory containing previous year question PDFs")
        .requiredOption("--reference-mock <dir>", "Directory containing reference mock PDFs")
        .requiredOption("-o, --output <filename>", "Output JSON filename")
        .requiredOption("--prompt <file>", "Path to user prompt file containing specific instructions for the mock test")
        .requiredOption("--api-key <key>", "Google AI API key")
        .option("--max-tokens <number>", "Maximum output tokens per request (default: 8192)", parseInt, 8192)
        .option("--temperature <number>", "Temperature for response generation (0.0-2.0, default: 0.7)", parseFloat, 0.7)
        .option("--thinking-budget <number>", "Thinking budget tokens for internal reasoning. Use -1 for dynamic, 0 to disable, or specific number (Flash: 1-24576, Flash-Lite: 512-24576, Pro: 128-32768)")
        .option("--model <model>", "Gemini model to use (default: gemini-2.5-flash)", "gemini-2.5-flash")
        .option("--no-streaming", "Disable streaming and use regular generation")
        .parse(process.argv);

    const options = program.opts();

    try {
        // 1. Validate API key
        options.apiKey = validateApiKey(options.apiKey);
        console.log("✅ API key validated");

        // 2. Validate directories
        console.log("📁 Validating directories...");
        await validateDirectories(options.pyq, options.referenceMock);

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
        console.log("\n📄 Processing input files...");
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

        // 6. Generate mock test
        console.log(`\n🚀 Starting mock test generation...`);
        console.log(`🤖 Model: ${options.model}`);
        console.log(`📊 Max tokens: ${options.maxTokens}`);
        console.log(`🌡️  Temperature: ${options.temperature}`);
        console.log(`📡 Streaming: ${!options.noStreaming ? 'Enabled' : 'Disabled'}`);
        
        const startTime = Date.now();
        
        // Ensure output file has .json extension
        let outputPath = options.output;
        if (!outputPath.endsWith('.json')) {
            outputPath += '.json';
        }
        
        let result;
        if (options.noStreaming) {
            result = await generateMockTestWithoutStreaming(contents, outputPath, options);
        } else {
            // Try streaming first, fallback to non-streaming if it fails
            result = await generateMockTestWithStreaming(contents, outputPath, options);
            if (!result.success && result.error?.message.includes('Symbol.asyncIterator')) {
                console.log("\n⚠️  Streaming failed, falling back to non-streaming mode...");
                result = await generateMockTestWithoutStreaming(contents, outputPath, options);
            }
        }
        
        const endTime = Date.now();
        const totalTime = (endTime - startTime) / 1000;

        if (result.success) {
            console.log(`\n🎉 Mock test generation completed successfully!`);
            console.log(`📁 Output file: ${result.outputPath}`);
            console.log(`📄 Content length: ${result.contentLength} characters`);
            console.log(`⏱️  Total time: ${totalTime.toFixed(2)} seconds`);
            
            // Display basic info about the generated test
            const jsonData = result.jsonData;
            console.log(`\n📋 Generated Test Info:`);
            console.log(`   Title: ${jsonData.examTitle}`);
            console.log(`   Questions: ${jsonData.examDetails.totalQuestions}`);
            console.log(`   Time: ${jsonData.examDetails.timeAllotted}`);
            console.log(`   Max Marks: ${jsonData.examDetails.maxMarks}`);
            console.log(`   Sections: ${jsonData.sections.length}`);
        } else {
            console.error(`\n❌ Mock test generation failed: ${result.error?.message || 'Unknown error'}`);
            process.exit(1);
        }

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
