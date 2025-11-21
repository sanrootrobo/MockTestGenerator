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

// --- API KEY MANAGEMENT ---
async function loadApiKeys(apiFilePath) {
    try {
        const content = await fs.readFile(apiFilePath, "utf-8");
        const keys = content
            .split('\n')
            .map(line => line.trim())
            .filter(line => line && !line.startsWith('#')) // Filter out empty lines and comments
            .map(key => validateApiKey(key));
        
        if (keys.length === 0) {
            throw new Error("No valid API keys found in the file");
        }
        
        console.log(`📋 Loaded ${keys.length} API key(s) from ${apiFilePath}`);
        return keys;
    } catch (error) {
        throw new Error(`Failed to load API keys from ${apiFilePath}: ${error.message}`);
    }
}

class ApiKeyManager {
    constructor(apiKeys) {
        this.apiKeys = apiKeys.map(key => ({ key, failures: 0, lastFailure: null }));
        this.currentIndex = 0;
    }

    getNextKey() {
        if (this.apiKeys.length === 1) {
            return this.apiKeys[0].key;
        }

        // Sort by failures (ascending) and last failure time (oldest first)
        const sortedKeys = this.apiKeys
            .filter(keyInfo => keyInfo.failures < 3) // Exclude keys with 3+ consecutive failures
            .sort((a, b) => {
                if (a.failures !== b.failures) {
                    return a.failures - b.failures;
                }
                return (a.lastFailure || 0) - (b.lastFailure || 0);
            });

        if (sortedKeys.length === 0) {
            // Reset all failure counts if all keys are exhausted
            console.log("🔄 Resetting all API key failure counts...");
            this.apiKeys.forEach(keyInfo => {
                keyInfo.failures = 0;
                keyInfo.lastFailure = null;
            });
            return this.apiKeys[0].key;
        }

        const selected = sortedKeys[0];
        return selected.key;
    }

    recordFailure(apiKey, error) {
        const keyInfo = this.apiKeys.find(info => info.key === apiKey);
        if (keyInfo) {
            keyInfo.failures++;
            keyInfo.lastFailure = Date.now();
            console.log(`⚠️  API key failure recorded (${keyInfo.failures}/3): ${error.message}`);
        }
    }

    recordSuccess(apiKey) {
        const keyInfo = this.apiKeys.find(info => info.key === apiKey);
        if (keyInfo) {
            keyInfo.failures = 0;
            keyInfo.lastFailure = null;
        }
    }

    getAvailableKeys() {
        return this.apiKeys.filter(keyInfo => keyInfo.failures < 3).map(keyInfo => keyInfo.key);
    }
}

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

// --- SINGLE MOCK TEST GENERATION ---
async function generateSingleMockTest(mockIndex, contents, outputDir, options, apiKeyManager) {
    const maxRetries = 3;
    let lastError = null;
    let currentApiKey = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            currentApiKey = apiKeyManager.getNextKey();
            if (!currentApiKey) {
                throw new Error("No available API keys");
            }

            console.log(`🔄 Mock ${mockIndex} - Attempt ${attempt}/${maxRetries} - Starting JSON generation...`);
            
            const ai = new GoogleGenAI({ apiKey: currentApiKey });
            
            // Create generation config
            const generationConfig = createGenerationConfig(options, options.model);
            
            console.log(`🚀 Mock ${mockIndex} - Starting generation...`);
            
            // Generate content - use streaming if not disabled
            let result;
            if (options.noStreaming) {
                result = await generateMockTestWithoutStreamingCore(ai, contents, generationConfig, options, mockIndex);
            } else {
                try {
                    result = await generateMockTestWithStreamingCore(ai, contents, generationConfig, options, mockIndex);
                } catch (streamError) {
                    if (streamError.message.includes('Symbol.asyncIterator') || streamError.message.includes('stream')) {
                        console.log(`⚠️  Mock ${mockIndex} - Streaming failed, falling back to non-streaming...`);
                        result = await generateMockTestWithoutStreamingCore(ai, contents, generationConfig, options, mockIndex);
                    } else {
                        throw streamError;
                    }
                }
            }

            // Parse and validate JSON
            let jsonData;
            try {
                let cleanJson = result.fullResponse.trim();
                if (cleanJson.startsWith('```json')) {
                    cleanJson = cleanJson.replace(/^```json\s*/, '').replace(/\s*```$/, '');
                } else if (cleanJson.startsWith('```')) {
                    cleanJson = cleanJson.replace(/^```\s*/, '').replace(/\s*```$/, '');
                }
                
                jsonData = JSON.parse(cleanJson);
                console.log(`✅ Mock ${mockIndex} - JSON parsing successful!`);
            } catch (parseError) {
                throw new Error(`Mock ${mockIndex} - Failed to parse JSON response: ${parseError.message}`);
            }

            // Validate JSON structure
            if (!jsonData.examTitle || !jsonData.examDetails || !jsonData.sections) {
                throw new Error(`Mock ${mockIndex} - Invalid JSON structure - missing required fields`);
            }

            console.log(`✅ Mock ${mockIndex} - JSON structure validation passed!`);

            // Generate output filename
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
            const outputFilename = `mock_test_${mockIndex}_${timestamp}.json`;
            const outputPath = path.join(outputDir, outputFilename);

            // Save JSON to file
            await fs.mkdir(outputDir, { recursive: true });
            await fs.writeFile(outputPath, JSON.stringify(jsonData, null, 2));
            console.log(`💾 Mock ${mockIndex} - JSON saved to: ${outputPath}`);
            
            // Record success for this API key
            apiKeyManager.recordSuccess(currentApiKey);
            
            return {
                success: true,
                mockIndex: mockIndex,
                outputPath: outputPath,
                contentLength: result.fullResponse.length,
                usage: result.usage,
                jsonData: jsonData
            };

        } catch (error) {
            lastError = error;
            
            // Record failure for this API key
            if (currentApiKey) {
                apiKeyManager.recordFailure(currentApiKey, error);
            }
            
            console.error(`❌ Mock ${mockIndex} - Attempt ${attempt} failed: ${error.message}`);
            
            if (attempt === maxRetries) {
                console.error(`❌ Mock ${mockIndex} - All ${maxRetries} attempts failed`);
                break;
            }
            
            // Wait before retrying
            const waitTime = Math.pow(1.5, attempt - 1) * 1000;
            console.log(`⏳ Mock ${mockIndex} - Waiting ${waitTime}ms before retry...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
    }

    return {
        success: false,
        mockIndex: mockIndex,
        error: lastError
    };
}

// --- CORE GENERATION FUNCTIONS ---
async function generateMockTestWithStreamingCore(ai, contents, generationConfig, options, mockIndex) {
    const requestParams = {
        model: options.model,
        contents: contents
    };
    
    if (Object.keys(generationConfig).length > 0) {
        requestParams.generationConfig = generationConfig;
    }
    
    console.log(`📝 Mock ${mockIndex} - Starting streaming generation...`);
    
    const response = await ai.models.generateContentStream(requestParams);
    
    let fullResponse = '';
    let chunkCount = 0;
    
    for await (const chunk of response) {
        const chunkText = chunk.text;
        if (chunkText) {
            fullResponse += chunkText;
            chunkCount++;
        }
    }
    
    console.log(`📊 Mock ${mockIndex} - Streaming completed: ${chunkCount} chunks received`);
    
    if (!fullResponse || fullResponse.trim().length === 0) {
        throw new Error("Empty response received from API");
    }
    
    return {
        fullResponse: fullResponse,
        usage: null // Usage metadata not available in streaming mode
    };
}

async function generateMockTestWithoutStreamingCore(ai, contents, generationConfig, options, mockIndex) {
    const requestParams = {
        model: options.model,
        contents: contents
    };
    
    if (Object.keys(generationConfig).length > 0) {
        requestParams.generationConfig = generationConfig;
    }
    
    console.log(`📝 Mock ${mockIndex} - Starting non-streaming generation...`);
    
    const result = await ai.models.generateContent(requestParams);
    const fullResponse = result.text;
    
    if (!fullResponse || fullResponse.trim().length === 0) {
        throw new Error("Empty response received from API");
    }
    
    console.log(`📊 Mock ${mockIndex} - Generation completed`);
    
    if (result.usageMetadata) {
        const usage = result.usageMetadata;
        console.log(`📊 Mock ${mockIndex} - Token usage - Input: ${usage.promptTokenCount || 'N/A'}, Output: ${usage.candidatesTokenCount || 'N/A'}, Thinking: ${usage.thoughtsTokenCount || 'N/A'}`);
    }
    
    return {
        fullResponse: fullResponse,
        usage: result.usageMetadata
    };
}

// --- PARALLEL MOCK GENERATION ---
async function generateMultipleMockTests(contents, outputDir, options, apiKeys) {
    const apiKeyManager = new ApiKeyManager(apiKeys);
    const numberOfMocks = options.numberOfMocks || 1;
    
    console.log(`🚀 Starting generation of ${numberOfMocks} mock test(s) using ${apiKeys.length} API key(s)...`);
    
    // Determine concurrency level based on available API keys
    const maxConcurrency = Math.min(apiKeys.length, numberOfMocks);
    console.log(`⚙️  Using ${maxConcurrency} concurrent requests`);
    
    const results = [];
    const errors = [];
    
    // Create batches for parallel processing
    const batches = [];
    for (let i = 0; i < numberOfMocks; i++) {
        batches.push(i + 1); // Mock indices start from 1
    }
    
    // Process batches with controlled concurrency
    for (let i = 0; i < batches.length; i += maxConcurrency) {
        const currentBatch = batches.slice(i, i + maxConcurrency);
        
        console.log(`\n📦 Processing batch ${Math.floor(i / maxConcurrency) + 1}: Mocks ${currentBatch.join(', ')}`);
        
        const batchPromises = currentBatch.map(mockIndex => 
            generateSingleMockTest(mockIndex, contents, outputDir, options, apiKeyManager)
        );
        
        const batchResults = await Promise.allSettled(batchPromises);
        
        batchResults.forEach((result, index) => {
            const mockIndex = currentBatch[index];
            if (result.status === 'fulfilled') {
                if (result.value.success) {
                    results.push(result.value);
                } else {
                    errors.push({ mockIndex, error: result.value.error });
                }
            } else {
                errors.push({ mockIndex, error: result.reason });
            }
        });
        
        // Brief pause between batches to avoid overwhelming the API
        if (i + maxConcurrency < batches.length) {
            console.log(`⏳ Brief pause before next batch...`);
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
    
    return { results, errors };
}

// --- MAIN EXECUTION ---
async function main() {
    program
        .requiredOption("--pyq <dir>", "Directory containing previous year question PDFs")
        .requiredOption("--reference-mock <dir>", "Directory containing reference mock PDFs")
        .requiredOption("-o, --output <dir>", "Output directory for generated mock tests")
        .requiredOption("--prompt <file>", "Path to user prompt file containing specific instructions for the mock test")
        .option("--api-key <key>", "Single Google AI API key (use this OR --api-file)")
        .option("--api-file <file>", "Path to file containing multiple Google AI API keys (one per line)")
        .option("--number-of-mocks <number>", "Number of mock tests to generate (default: 1)", parseInt, 1)
        .option("--max-tokens <number>", "Maximum output tokens per request (default: 8192)", parseInt, 8192)
        .option("--temperature <number>", "Temperature for response generation (0.0-2.0, default: 0.7)", parseFloat, 0.7)
        .option("--thinking-budget <number>", "Thinking budget tokens for internal reasoning. Use -1 for dynamic, 0 to disable, or specific number (Flash: 1-24576, Flash-Lite: 512-24576, Pro: 128-32768)")
        .option("--model <model>", "Gemini model to use (default: gemini-2.5-flash)", "gemini-2.5-flash")
        .option("--no-streaming", "Disable streaming and use regular generation")
        .parse(process.argv);

    const options = program.opts();

    try {
        // 1. Validate API key options
        let apiKeys = [];
        
        if (options.apiKey && options.apiFile) {
            console.error("❌ Error: Please specify either --api-key OR --api-file, not both.");
            process.exit(1);
        }
        
        if (!options.apiKey && !options.apiFile) {
            console.error("❌ Error: Please specify either --api-key or --api-file.");
            process.exit(1);
        }
        
        if (options.apiKey) {
            apiKeys = [validateApiKey(options.apiKey)];
            console.log("✅ Single API key validated");
        } else {
            apiKeys = await loadApiKeys(options.apiFile);
        }

        // 2. Validate number of mocks
        if (options.numberOfMocks < 1 || options.numberOfMocks > 100) {
            console.error("❌ Error: Number of mocks must be between 1 and 100.");
            process.exit(1);
        }

        // 3. Validate directories
        console.log("📁 Validating directories...");
        await validateDirectories(options.pyq, options.referenceMock);

        // 4. Read user prompt file
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

        // 5. Process PDF Files
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

        // 6. Construct the API Request content
        const contents = [
            { text: systemPrompt },
            { text: "--- REFERENCE PYQ PDFS ---" },
            ...pyqParts,
            { text: "--- REFERENCE MOCK TEST PDFS ---" },
            ...refMockParts,
            { text: "--- USER INSTRUCTIONS ---" },
            { text: userPrompt }
        ];

        // 7. Generate mock tests
        console.log(`\n🚀 Starting mock test generation...`);
        console.log(`🤖 Model: ${options.model}`);
        console.log(`📊 Max tokens: ${options.maxTokens}`);
        console.log(`🌡️  Temperature: ${options.temperature}`);
        console.log(`📡 Streaming: ${!options.noStreaming ? 'Enabled' : 'Disabled'}`);
        console.log(`📝 Number of mocks: ${options.numberOfMocks}`);
        console.log(`🔑 API keys: ${apiKeys.length}`);
        
        const startTime = Date.now();
        
        // Ensure output directory exists
        await fs.mkdir(options.output, { recursive: true });
        
        const { results, errors } = await generateMultipleMockTests(contents, options.output, options, apiKeys);
        
        const endTime = Date.now();
        const totalTime = (endTime - startTime) / 1000;

        // 8. Report results
        console.log(`\n${'='.repeat(60)}`);
        console.log(`🎉 MOCK TEST GENERATION SUMMARY`);
        console.log(`${'='.repeat(60)}`);
        console.log(`⏱️  Total time: ${totalTime.toFixed(2)} seconds`);
        console.log(`✅ Successful: ${results.length}/${options.numberOfMocks}`);
        console.log(`❌ Failed: ${errors.length}/${options.numberOfMocks}`);

        if (results.length > 0) {
            console.log(`\n📋 Successfully Generated Mock Tests:`);
            results.forEach(result => {
                console.log(`   Mock ${result.mockIndex}:`);
                console.log(`     📁 File: ${path.basename(result.outputPath)}`);
                console.log(`     📊 Size: ${(result.contentLength / 1024).toFixed(2)} KB`);
                if (result.jsonData) {
                    console.log(`     📝 Questions: ${result.jsonData.examDetails?.totalQuestions || 'N/A'}`);
                    console.log(`     ⏰ Time: ${result.jsonData.examDetails?.timeAllotted || 'N/A'}`);
                }
            });
        }

        if (errors.length > 0) {
            console.log(`\n❌ Failed Mock Tests:`);
            errors.forEach(error => {
                console.log(`   Mock ${error.mockIndex}: ${error.error?.message || 'Unknown error'}`);
            });
        }

        console.log(`\n📂 Output directory: ${options.output}`);
        
        // Exit with appropriate code
        if (errors.length > 0 && results.length === 0) {
            console.error(`\n❌ All mock test generations failed!`);
            process.exit(1);
        } else if (errors.length > 0) {
            console.warn(`\n⚠️  Some mock test generations failed. Check the errors above.`);
            process.exit(0); // Partial success
        } else {
            console.log(`\n🎉 All mock tests generated successfully!`);
        }

    } catch (error) {
        console.error("\n❌ An unexpected error occurred:");
        console.error(`- ${error.message}`);
        console.error("\nStack trace:");
        console.error(error.stack);
        process.exit(1);
    }
}

        // 3. Validate number of mocks
        if (options.numberOfMocks < 1 || options.numberOfMocks > 100) {
            console.error("❌ Error: Number of mocks must be between 1 and 100.");
            process.exit(1);
        }

        // 4. Validate directories
        console.log("📁 Validating directories...");
        await validateDirectories(options.pyq, options.referenceMock);

        // 5. Read user prompt file
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

        // 6. Process PDF Files
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

        // 7. Construct the API Request content
        const contents = [
            { text: systemPrompt },
            { text: "--- REFERENCE PYQ PDFS ---" },
            ...pyqParts,
            { text: "--- REFERENCE MOCK TEST PDFS ---" },
            ...refMockParts,
            { text: "--- USER INSTRUCTIONS ---" },
            { text: userPrompt }
        ];

        // 8. Generate mock tests
        console.log(`\n🚀 Starting mock test generation...`);
        console.log(`🤖 Model: ${options.model}`);
        console.log(`📊 Max tokens: ${options.maxTokens}`);
        console.log(`🌡️  Temperature: ${options.temperature}`);
        console.log(`📡 Streaming: ${!options.noStreaming ? 'Enabled' : 'Disabled'}`);
        console.log(`📝 Number of mocks: ${options.numberOfMocks}`);
        console.log(`🔑 API keys: ${apiKeys.length}`);
        
        const startTime = Date.now();
        
        // Ensure output directory exists
        await fs.mkdir(options.output, { recursive: true });
        
        const { results, errors } = await generateMultipleMockTests(contents, options.output, options, apiKeys);
        
        const endTime = Date.now();
        const totalTime = (endTime - startTime) / 1000;

        // 9. Report results
        console.log(`\n${'='.repeat(60)}`);
        console.log(`🎉 MOCK TEST GENERATION SUMMARY`);
        console.log(`${'='.repeat(60)}`);
        console.log(`⏱️  Total time: ${totalTime.toFixed(2)} seconds`);
        console.log(`✅ Successful: ${results.length}/${options.numberOfMocks}`);
        console.log(`❌ Failed: ${errors.length}/${options.numberOfMocks}`);

        if (results.length > 0) {
            console.log(`\n📋 Successfully Generated Mock Tests:`);
            results.forEach(result => {
                console.log(`   Mock ${result.mockIndex}:`);
                console.log(`     📁 File: ${path.basename(result.outputPath)}`);
                console.log(`     📊 Size: ${(result.contentLength / 1024).toFixed(2)} KB`);
                if (result.jsonData) {
                    console.log(`     📝 Questions: ${result.jsonData.examDetails?.totalQuestions || 'N/A'}`);
                    console.log(`     ⏰ Time: ${result.jsonData.examDetails?.timeAllotted || 'N/A'}`);
                }
            });
        }

        if (errors.length > 0) {
            console.log(`\n❌ Failed Mock Tests:`);
            errors.forEach(error => {
                console.log(`   Mock ${error.mockIndex}: ${error.error?.message || 'Unknown error'}`);
            });
        }

        console.log(`\n📂 Output directory: ${options.output}`);
        
        // Exit with appropriate code
        if (errors.length > 0 && results.length === 0) {
            console.error(`\n❌ All mock test generations failed!`);
            process.exit(1);
        } else if (errors.length > 0) {
            console.warn(`\n⚠️  Some mock test generations failed. Check the errors above.`);
            process.exit(0); // Partial success
        } else {
            console.log(`\n🎉 All mock tests generated successfully!`);
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
