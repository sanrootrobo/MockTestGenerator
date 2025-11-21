//Looking at your quota limit issue, here are several strategies to bypass the 125,000 input tokens per minute free-tier limit:
//Strategy 1: Smart Token Management (Immediate Fix)

// Enhanced API Key Manager with Token Tracking
class TokenAwareApiKeyManager extends ApiKeyManager {
    constructor(apiKeys) {
        super(apiKeys);
        
        // Track tokens per key per minute
        this.tokenUsagePerMinute = new Map();
        this.lastResetTime = new Map();
        this.FREE_TIER_LIMIT = 125000; // tokens per minute
        
        // Initialize tracking for each key
        this.apiKeys.forEach((key, index) => {
            this.tokenUsagePerMinute.set(index, 0);
            this.lastResetTime.set(index, Date.now());
        });
    }

    // Estimate tokens in content (rough approximation: 1 token ≈ 4 characters)
    estimateTokens(contents) {
        let totalChars = 0;
        
        contents.forEach(content => {
            if (content.text) {
                totalChars += content.text.length;
            }
            // PDF content is base64 encoded, so it's much larger
            if (content.inlineData) {
                // Base64 is ~1.33x larger than original, and PDFs are token-heavy
                totalChars += content.inlineData.data.length * 0.75; // Rough estimate
            }
        });
        
        // Conservative estimate: 1 token per 3 characters for safety
        return Math.ceil(totalChars / 3);
    }

    // Reset token counter if a minute has passed
    resetTokenCounterIfNeeded(keyIndex) {
        const now = Date.now();
        const lastReset = this.lastResetTime.get(keyIndex) || 0;
        
        if (now - lastReset >= 60000) { // 60 seconds
            this.tokenUsagePerMinute.set(keyIndex, 0);
            this.lastResetTime.set(keyIndex, now);
            console.log(`🔄 Reset token counter for API Key ${keyIndex + 1}`);
        }
    }

    // Check if key can handle the estimated tokens
    canHandleTokens(keyIndex, estimatedTokens) {
        this.resetTokenCounterIfNeeded(keyIndex);
        const currentUsage = this.tokenUsagePerMinute.get(keyIndex) || 0;
        return (currentUsage + estimatedTokens) <= this.FREE_TIER_LIMIT;
    }

    // Track token usage after successful request
    trackTokenUsage(keyIndex, actualTokens) {
        this.resetTokenCounterIfNeeded(keyIndex);
        const currentUsage = this.tokenUsagePerMinute.get(keyIndex) || 0;
        this.tokenUsagePerMinute.set(keyIndex, currentUsage + actualTokens);
        
        console.log(`📊 API Key ${keyIndex + 1}: ${currentUsage + actualTokens}/${this.FREE_TIER_LIMIT} tokens this minute`);
    }

    // Get the best available key for a request
    getBestKeyForTokens(estimatedTokens, excludeIndex = -1) {
        // First try assigned keys that can handle the tokens
        for (let i = 0; i < this.apiKeys.length; i++) {
            if (i !== excludeIndex && 
                !this.failedKeys.has(i) && 
                this.canHandleTokens(i, estimatedTokens)) {
                return { key: this.apiKeys[i], index: i };
            }
        }

        // If no key can handle it immediately, find the one with least recent usage
        let bestIndex = -1;
        let oldestReset = Date.now();
        
        for (let i = 0; i < this.apiKeys.length; i++) {
            if (i !== excludeIndex && !this.failedKeys.has(i)) {
                const lastReset = this.lastResetTime.get(i) || 0;
                if (lastReset < oldestReset) {
                    oldestReset = lastReset;
                    bestIndex = i;
                }
            }
        }

        if (bestIndex === -1) {
            throw new Error("No available API keys");
        }

        return { key: this.apiKeys[bestIndex], index: bestIndex };
    }
}

// Enhanced generation function with smart delays
async function generateSingleMockWithTokens(contents, outputPath, mockNumber, totalMocks, options) {
    const maxRetries = 3;
    let lastError = null;
    let currentKeyInfo = null;

    // Estimate tokens in the request
    const estimatedTokens = apiKeyManager.estimateTokens(contents);
    console.log(`🧮 Estimated tokens for mock ${mockNumber}: ${estimatedTokens.toLocaleString()}`);

    // Check if request is too large for free tier
    if (estimatedTokens > apiKeyManager.FREE_TIER_LIMIT) {
        console.warn(`⚠️  Request size (${estimatedTokens.toLocaleString()}) exceeds per-minute limit (${apiKeyManager.FREE_TIER_LIMIT.toLocaleString()})`);
        console.warn(`📝 Consider splitting reference materials or using a paid plan`);
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            // Get best available key for this token count
            currentKeyInfo = apiKeyManager.getBestKeyForTokens(estimatedTokens);
            console.log(`🔑 Mock ${mockNumber}/${totalMocks} - Attempt ${attempt}/${maxRetries} (API Key ${currentKeyInfo.index + 1})`);
            
            // Check if we need to wait for quota reset
            if (!apiKeyManager.canHandleTokens(currentKeyInfo.index, estimatedTokens)) {
                const waitTime = 60000 - (Date.now() - (apiKeyManager.lastResetTime.get(currentKeyInfo.index) || 0));
                if (waitTime > 0) {
                    console.log(`⏳ Waiting ${Math.ceil(waitTime/1000)}s for quota reset on Key ${currentKeyInfo.index + 1}...`);
                    await new Promise(resolve => setTimeout(resolve, waitTime + 1000)); // +1s buffer
                }
            }

            const genAI = new GoogleGenAI({ apiKey: currentKeyInfo.key });
            
            // Create generation config
            const generationConfig = createGenerationConfig(options, options.model);
            
            const requestParams = {
                model: options.model,
                contents: contents
            };
            
            if (Object.keys(generationConfig).length > 0) {
                requestParams.generationConfig = generationConfig;
            }
            
            // Add intelligent delay based on estimated tokens
            const baseDelay = options.rateLimitDelay || 1000;
            const tokenBasedDelay = Math.min(5000, Math.max(1000, estimatedTokens / 50)); // Scale with request size
            const adjustedDelay = Math.max(baseDelay, tokenBasedDelay) / apiKeyManager.apiKeys.length;
            
            if (adjustedDelay > 0) {
                await new Promise(resolve => setTimeout(resolve, adjustedDelay));
            }
            
            const response = await genAI.models.generateContent(requestParams);
            
            if (!response || !response.text) {
                throw new Error("No response received from API");
            }

            // Track actual token usage
            if (response.usageMetadata && response.usageMetadata.promptTokenCount) {
                apiKeyManager.trackTokenUsage(currentKeyInfo.index, response.usageMetadata.promptTokenCount);
            } else {
                // Fallback to estimated tokens
                apiKeyManager.trackTokenUsage(currentKeyInfo.index, estimatedTokens);
            }

            // Log detailed usage
            if (response.usageMetadata) {
                const usage = response.usageMetadata;
                console.log(`📊 Actual usage (Key ${currentKeyInfo.index + 1}) - Input: ${usage.promptTokenCount || 'N/A'}, Output: ${usage.candidatesTokenCount || 'N/A'}, Thinking: ${usage.thoughtsTokenCount || 'N/A'}`);
            }

            // Continue with existing JSON processing...
            const generatedJson = response.text;
            
            if (!generatedJson || generatedJson.trim().length === 0) {
                throw new Error("Empty response received from API");
            }

            // Parse JSON and generate outputs (same as before)...
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

            // Continue with file generation (same as original)...
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

            console.log(`🔄 Converting JSON to HTML for mock ${mockNumber}...`);
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

            console.log(`📄 Converting to PDF: ${path.basename(outputPath)}`);
            await generatePdf(htmlContent, outputPath);

            if (options.ppt) {
                const pptOutputPath = generateOutputFilename(options.output, mockNumber, totalMocks, '.pptx');
                const backgroundPath = options.pptBackground || null;
                await generatePptFromJson(jsonData, pptOutputPath, backgroundPath);
            }
            
            apiKeyManager.incrementUsage(currentKeyInfo.index);
            
            console.log(`✅ Mock ${mockNumber}/${totalMocks} completed with API Key ${currentKeyInfo.index + 1}: ${path.basename(outputPath)}`);
            
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
                               error.message.includes('rate limit') ||
                               error.message.includes('429');
            
            if (isQuotaError && currentKeyInfo) {
                console.log(`⚠️  Quota exceeded on Key ${currentKeyInfo.index + 1}, marking as temporarily failed`);
                
                // Don't permanently mark as failed for quota errors, just wait
                if (attempt < maxRetries) {
                    console.log(`⏳ Waiting 70 seconds for quota reset...`);
                    await new Promise(resolve => setTimeout(resolve, 70000)); // Wait longer than suggested
                    continue;
                }
            }
            
            if (attempt === maxRetries) {
                console.error(`❌ Mock ${mockNumber}/${totalMocks} failed after ${maxRetries} attempts`);
                break;
            }
            
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


// Content optimization utilities
class ContentOptimizer {
    constructor(maxTokensPerRequest = 100000) { // Leave 25k buffer
        this.maxTokensPerRequest = maxTokensPerRequest;
    }

    // Estimate tokens more accurately
    estimateTokens(text) {
        // More accurate estimation for different content types
        const cleanText = text.replace(/\s+/g, ' ').trim();

        // Base64 PDF content is very token-heavy
        if (text.includes('data:')) {
            return Math.ceil(text.length / 2); // Base64 is ~2 chars per token
        }

        // Regular text: ~4 chars per token
        return Math.ceil(cleanText.length / 4);
    }

    // Split PDF files into smaller chunks
    async filesToOptimizedParts(filePaths, label, maxSizePerChunk = 15 * 1024 * 1024) {
        const parts = [];
        const maxFileSize = 20 * 1024 * 1024; // Keep original limit

        // Sort files by size to process smaller ones first
        const filesWithSizes = await Promise.all(
            filePaths.map(async filePath => ({
                path: filePath,
                size: await getFileSize(filePath)
            }))
        );

        filesWithSizes.sort((a, b) => a.size - b.size);

        let currentChunkSize = 0;
        let currentChunk = [];

        for (const fileInfo of filesWithSizes) {
            console.log(`- Processing ${label}: ${path.basename(fileInfo.path)} (${(fileInfo.size / 1024 / 1024).toFixed(2)}MB)`);

            try {
                if (fileInfo.size > maxFileSize) {
                    console.warn(`  - Warning: File ${path.basename(fileInfo.path)} is ${(fileInfo.size / 1024 / 1024).toFixed(2)}MB, which exceeds the 20MB limit. Skipping.`);
                    continue;
                }

                // If adding this file would exceed chunk size, finalize current chunk
                if (currentChunkSize + fileInfo.size > maxSizePerChunk && currentChunk.length > 0) {
                    console.log(`  - Chunk completed with ${currentChunk.length} files (${(currentChunkSize / 1024 / 1024).toFixed(2)}MB)`);

                    // Process current chunk
                    for (const chunkFile of currentChunk) {
                        const fileBuffer = await fs.readFile(chunkFile.path);
                        parts.push({
                            inlineData: {
                                mimeType: 'application/pdf',
                                data: fileBuffer.toString('base64'),
                            },
                        });
                    }

                    // Reset for new chunk
                    currentChunk = [];
                    currentChunkSize = 0;
                }

                currentChunk.push(fileInfo);
                currentChunkSize += fileInfo.size;

            } catch (error) {
                console.error(`  - Warning: Could not read file ${fileInfo.path}. Error: ${error.message}. Skipping.`);
            }
        }

        // Process remaining files in the last chunk
        if (currentChunk.length > 0) {
            console.log(`  - Final chunk with ${currentChunk.length} files (${(currentChunkSize / 1024 / 1024).toFixed(2)}MB)`);

            for (const chunkFile of currentChunk) {
                try {
                    const fileBuffer = await fs.readFile(chunkFile.path);
                    parts.push({
                        inlineData: {
                            mimeType: 'application/pdf',
                            data: fileBuffer.toString('base64'),
                        },
                    });
                } catch (error) {
                    console.error(`  - Warning: Could not read file ${chunkFile.path}. Error: ${error.message}. Skipping.`);
                }
            }
        }

        return parts;
    }

    // Create multiple request variants with different content subsets
    createOptimizedRequests(pyqParts, refMockParts, userPrompt, systemPrompt) {
        const requests = [];

        // Calculate tokens for different parts
        const systemTokens = this.estimateTokens(systemPrompt);
        const userTokens = this.estimateTokens(userPrompt);
        const baseTokens = systemTokens + userTokens + 1000; // Buffer for formatting

        console.log(`📊 Base tokens (system + user): ${baseTokens.toLocaleString()}`);

        // Strategy 1: Use only essential reference materials
        if (pyqParts.length > 0 || refMockParts.length > 0) {
            // Use smaller subset of files
            const maxReferenceParts = Math.min(3, pyqParts.length + refMockParts.length);
            const selectedParts = [...pyqParts, ...refMockParts].slice(0, maxReferenceParts);

            const request1 = [
                { text: systemPrompt },
                { text: "--- ESSENTIAL REFERENCE MATERIALS (SUBSET) ---" },
                ...selectedParts,
                { text: "--- USER INSTRUCTIONS ---" },
                { text: userPrompt }
            ];

            const request1Tokens = this.estimateRequestTokens(request1);
            if (request1Tokens <= this.maxTokensPerRequest) {
                requests.push({
                    contents: request1,
                    estimatedTokens: request1Tokens,
                    description: `Essential references (${maxReferenceParts} files)`
                });
            }
        }

        // Strategy 2: PYQ-only approach
        if (pyqParts.length > 0) {
            const maxPyqParts = Math.min(5, pyqParts.length);
            const selectedPyq = pyqParts.slice(0, maxPyqParts);

            const request2 = [
                { text: systemPrompt },
                { text: "--- REFERENCE PYQ MATERIALS ---" },
                ...selectedPyq,
                { text: "--- USER INSTRUCTIONS ---" },
                { text: userPrompt }
            ];

            const request2Tokens = this.estimateRequestTokens(request2);
            if (request2Tokens <= this.maxTokensPerRequest) {
                requests.push({
                    contents: request2,
                    estimatedTokens: request2Tokens,
                    description: `PYQ-focused (${maxPyqParts} files)`
                });
            }
        }

        // Strategy 3: Minimal approach (no reference files, enhanced prompt)
        const enhancedPrompt = `${userPrompt}

IMPORTANT: Since reference materials are limited due to token constraints, please create high-quality questions based on:
1. Common competitive exam patterns you know
2. The specific subject area and difficulty level mentioned
3. Standard question formats for this type of exam

Ensure all questions are original, well-structured, and include detailed solutions.`;

        const request3 = [
            { text: systemPrompt },
            { text: "--- USER INSTRUCTIONS (ENHANCED) ---" },
            { text: enhancedPrompt }
        ];

        const request3Tokens = this.estimateRequestTokens(request3);
        requests.push({
            contents: request3,
            estimatedTokens: request3Tokens,
            description: "Minimal approach (no reference files)"
        });

        // Sort by estimated tokens (smallest first)
        requests.sort((a, b) => a.estimatedTokens - b.estimatedTokens);

        console.log(`📋 Created ${requests.length} optimized request variants:`);
        requests.forEach((req, i) => {
            console.log(`  ${i + 1}. ${req.description}: ${req.estimatedTokens.toLocaleString()} tokens`);
        });

        return requests;
    }

    estimateRequestTokens(contents) {
        let totalTokens = 0;

        contents.forEach(content => {
            if (content.text) {
                totalTokens += this.estimateTokens(content.text);
            }
            if (content.inlineData && content.inlineData.data) {
                totalTokens += this.estimateTokens(content.inlineData.data);
            }
        });

        return totalTokens;
    }
}

// Modified main function to use optimized requests
async function generateSingleMockOptimized(requestVariants, outputPath, mockNumber, totalMocks, options) {
    const maxRetries = 3;
    let lastError = null;

    // Try each request variant until one succeeds
    for (let variantIndex = 0; variantIndex < requestVariants.length; variantIndex++) {
        const variant = requestVariants[variantIndex];

        console.log(`🔄 Mock ${mockNumber}/${totalMocks} - Trying variant ${variantIndex + 1}/${requestVariants.length}: ${variant.description}`);
        console.log(`🧮 Estimated tokens: ${variant.estimatedTokens.toLocaleString()}`);

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const currentKeyInfo = apiKeyManager.getBestKeyForTokens(variant.estimatedTokens);
                console.log(`🔑 Using API Key ${currentKeyInfo.index + 1} - Attempt ${attempt}/${maxRetries}`);

                // Check quota availability
                if (!apiKeyManager.canHandleTokens(currentKeyInfo.index, variant.estimatedTokens)) {
                    const waitTime = 60000 - (Date.now() - (apiKeyManager.lastResetTime.get(currentKeyInfo.index) || 0));
                    if (waitTime > 0) {
                        console.log(`⏳ Waiting ${Math.ceil(waitTime/1000)}s for quota reset...`);
                        await new Promise(resolve => setTimeout(resolve, waitTime + 2000));
                    }
                }

                const genAI = new GoogleGenAI({ apiKey: currentKeyInfo.key });
                const generationConfig = createGenerationConfig(options, options.model);

                const requestParams = {
                    model: options.model,
                    contents: variant.contents
                };

                if (Object.keys(generationConfig).length > 0) {
                    requestParams.generationConfig = generationConfig;
                }

                // Smart delay based on request size
                const delay = Math.min(5000, Math.max(2000, variant.estimatedTokens / 25));
                await new Promise(resolve => setTimeout(resolve, delay));

                const response = await genAI.models.generateContent(requestParams);

                if (!response || !response.text) {
                    throw new Error("No response received from API");
                }

                // Track usage
                if (response.usageMetadata && response.usageMetadata.promptTokenCount) {
                    apiKeyManager.trackTokenUsage(currentKeyInfo.index, response.usageMetadata.promptTokenCount);
                } else {
                    apiKeyManager.trackTokenUsage(currentKeyInfo.index, variant.estimatedTokens);
                }

                // Process the response (same as before)
                const generatedJson = response.text;

                if (!generatedJson || generatedJson.trim().length === 0) {
                    throw new Error("Empty response received from API");
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

                // Generate output files (same as before)
                const outputDir = path.dirname(outputPath);
                if (outputDir !== '.') {
                    await fs.mkdir(outputDir, { recursive: true });
                }

                if (options.saveJson) {
                    const debugJsonPath = generateDebugJsonFilename(options.output, mockNumber, totalMocks);
                    await fs.writeFile(debugJsonPath, JSON.stringify(jsonData, null, 2));
                    console.log(`[DEBUG] Raw JSON saved to: ${debugJsonPath}`);
                }

                const htmlContent = convertJsonToHtml(jsonData);

                if (options.saveHtml) {
                    const debugHtmlPath = generateDebugHtmlFilename(options.output, mockNumber, totalMocks);
                    await fs.writeFile(debugHtmlPath, htmlContent);
                    console.log(`[DEBUG] Generated HTML saved to: ${debugHtmlPath}`);
                }

                await generatePdf(htmlContent, outputPath);

                if (options.ppt) {
                    const pptOutputPath = generateOutputFilename(options.output, mockNumber, totalMocks, '.pptx');
                    await generatePptFromJson(jsonData, pptOutputPath, options.pptBackground);
                }

                console.log(`✅ Mock ${mockNumber}/${totalMocks} completed successfully using variant: ${variant.description}`);

                return {
                    success: true,
                    outputPath: outputPath,
                    contentLength: generatedJson.length,
                    keyIndex: currentKeyInfo.index,
                    usage: response.usageMetadata,
                    mockNumber: mockNumber,
                    jsonData: jsonData,
                    variantUsed: variant.description
                };

            } catch (error) {
                lastError = error;
                const isQuotaError = error.message.includes('quota') ||
                                   error.message.includes('RESOURCE_EXHAUSTED') ||
                                   error.message.includes('rate limit') ||
                                   error.message.includes('429');

                if (isQuotaError) {
                    console.log(`⚠️  Quota error with variant ${variantIndex + 1}, attempt ${attempt}`);
                    if (attempt < maxRetries) {
                        console.log(`⏳ Waiting 75 seconds before retry...`);
                        await new Promise(resolve => setTimeout(resolve, 75000));
                        continue;
                    } else {
                        console.log(`➡️  Moving to next variant...`);
                        break; // Try next variant
                    }
                }

                if (attempt === maxRetries) {
                    console.log(`❌ Variant ${variantIndex + 1} failed after ${maxRetries} attempts`);
                    break;
                }

                const waitTime = Math.pow(1.5, attempt - 1) * 1000;
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }
        }
    }

    return {
        success: false,
        error: lastError || new Error("All request variants failed"),
        outputPath: outputPath
    };
}



// Replace the main function in your script with this enhanced version
async function enhancedMain() {
    // ... (keep all the existing program.parse() and validation code) ...

    try {
        console.log("🔧 Initializing enhanced quota management...");

        // Replace ApiKeyManager with TokenAwareApiKeyManager
        apiKeyManager = new TokenAwareApiKeyManager(apiKeys);

        // Initialize content optimizer
        const contentOptimizer = new ContentOptimizer(100000); // 100k tokens max per request

        // ... (keep existing directory validation and file reading code) ...

        // 4. Process PDF Files with optimization
        console.log("\n📂 Processing input files with optimization...");
        const pyqFiles = await findPdfFiles(options.pyq);
        const refMockFiles = await findPdfFiles(options.referenceMock);

        console.log(`Found ${pyqFiles.length} PYQ PDF files`);
        console.log(`Found ${refMockFiles.length} reference mock PDF files`);

        if (pyqFiles.length === 0 && refMockFiles.length === 0) {
            console.error("\nError: No PDF files found in the provided directories. Aborting.");
            process.exit(1);
        }

        // Use optimized file processing
        console.log("🔄 Optimizing PDF content for token limits...");
        const pyqParts = await contentOptimizer.filesToOptimizedParts(pyqFiles, "PYQ");
        const refMockParts = await contentOptimizer.filesToOptimizedParts(refMockFiles, "Reference Mock");

        if (pyqParts.length === 0 && refMockParts.length === 0) {
            console.error("\nError: No valid PDF files could be processed. Aborting.");
            process.exit(1);
        }

        // 5. Create optimized request variants
        console.log("\n🚀 Creating optimized request variants...");
        const requestVariants = contentOptimizer.createOptimizedRequests(
            pyqParts,
            refMockParts,
            userPrompt,
            systemPrompt
        );

        if (requestVariants.length === 0) {
            console.error("\nError: Could not create any viable request variants. Content may be too large.");
            process.exit(1);
        }

        // 6. Generate mock tests with enhanced strategy
        console.log(`\n🚀 Starting generation of ${numberOfMocks} mock test(s) with quota optimization...`);
        let outputFormats = ["JSON", "PDF"];
        if (options.ppt) outputFormats.push("PowerPoint");
        console.log(`📄 Output Formats: ${outputFormats.join(', ')}`);
        if (options.saveJson) console.log("💾 Debug JSON files will be saved.");
        if (options.saveHtml) console.log("💾 Debug HTML files will be saved.");

        const startTime = Date.now();

        // Create generation tasks with optimized approach
        const generationTasks = [];
        for (let i = 1; i <= numberOfMocks; i++) {
            const outputPath = generateOutputFilename(options.output, i, numberOfMocks, '.pdf');
            // Each task gets a copy of request variants to try
            generationTasks.push(() => generateSingleMockOptimized(
                JSON.parse(JSON.stringify(requestVariants)), // Deep copy
                outputPath,
                i,
                numberOfMocks,
                options
            ));
        }

        // Execute with smart concurrency (reduce concurrent requests to avoid quota issues)
        const smartConcurrentLimit = Math.min(maxConcurrent, 2, apiKeyManager.apiKeys.length);
        console.log(`🔄 Using smart concurrency limit: ${smartConcurrentLimit}`);

        const results = [];
        for(let i = 0; i < generationTasks.length; i += smartConcurrentLimit) {
            console.log(`\n📦 Processing batch ${Math.floor(i/smartConcurrentLimit) + 1}/${Math.ceil(generationTasks.length/smartConcurrentLimit)}`);

            const batch = generationTasks.slice(i, i + smartConcurrentLimit).map(task => task());
            const batchResults = await Promise.allSettled(batch);
            results.push(...batchResults);

            // Add inter-batch delay to prevent quota exhaustion
            if (i + smartConcurrentLimit < generationTasks.length) {
                console.log(`⏳ Inter-batch cooling period: 30 seconds...`);
                await new Promise(resolve => setTimeout(resolve, 30000));
            }
        }

        const endTime = Date.now();
        const totalTime = (endTime - startTime) / 1000;

        // Process results with enhanced reporting
        const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).map(r => r.value);
        const failed = results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success));

        console.log(`\n📈 Enhanced Generation Summary:`);
        console.log(`✅ Successful: ${successful.length}/${numberOfMocks}`);
        console.log(`❌ Failed: ${failed.length}/${numberOfMocks}`);
        console.log(`⏱️  Total time: ${totalTime.toFixed(2)} seconds`);
        console.log(`🔑 API Keys used: ${new Set(successful.map(r => r.keyIndex)).size}/${apiKeyManager.apiKeys.length}`);

        // Show which variants were most successful
        if (successful.length > 0) {
            const variantUsage = {};
            successful.forEach(result => {
                const variant = result.variantUsed || 'Unknown';
                variantUsage[variant] = (variantUsage[variant] || 0) + 1;
            });

            console.log(`\n📊 Request Variant Success Rate:`);
            Object.entries(variantUsage).forEach(([variant, count]) => {
                console.log(`  - ${variant}: ${count}/${numberOfMocks} (${((count/numberOfMocks) * 100).toFixed(1)}%)`);
            });
        }

        // Enhanced file listing
        if (successful.length > 0) {
            console.log(`\n📁 Generated Files:`);
            successful.sort((a,b) => a.mockNumber - b.mockNumber).forEach(mockResult => {
                console.log(`  📄 ${path.basename(mockResult.outputPath)} (${mockResult.contentLength} chars, API Key ${mockResult.keyIndex + 1}, ${mockResult.variantUsed})`);
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
        }

        // Enhanced failure reporting
        if (failed.length > 0) {
            console.log(`\n⚠️  Failed generations with details:`);
            failed.forEach((result, i) => {
                const error = result.reason || result.value?.error;
                const outputPath = result.value?.outputPath || `Task ${i+1}`;
                const isQuotaError = error?.message?.includes('quota') || error?.message?.includes('RESOURCE_EXHAUSTED');
                const errorType = isQuotaError ? '[QUOTA]' : '[ERROR]';
                console.log(`  ${errorType} ${path.basename(outputPath)}: ${error?.message || 'Unknown error'}`);
            });

            // Provide actionable advice
            const quotaErrors = failed.filter(result => {
                const error = result.reason || result.value?.error;
                return error?.message?.includes('quota') || error?.message?.includes('RESOURCE_EXHAUSTED');
            });

            if (quotaErrors.length > 0) {
                console.log(`\n💡 Quota Management Suggestions:`);
                console.log(`  - ${quotaErrors.length} failures were quota-related`);
                console.log(`  - Consider adding more API keys to api_key.txt`);
                console.log(`  - Try reducing the number of reference PDF files`);
                console.log(`  - Consider upgrading to a paid Gemini API plan for higher quotas`);
                console.log(`  - Increase delays with --rate-limit-delay 5000 or higher`);
            }
        }

        // Token usage summary
        console.log(`\n📊 Token Usage Summary:`);
        apiKeyManager.apiKeys.forEach((key, index) => {
            const usage = apiKeyManager.tokenUsagePerMinute.get(index) || 0;
            const usagePercent = ((usage / apiKeyManager.FREE_TIER_LIMIT) * 100).toFixed(1);
            const status = apiKeyManager.failedKeys.has(index) ? '❌ FAILED' : '✅ ACTIVE';
            console.log(`  Key ${index + 1}: ${usage.toLocaleString()}/${apiKeyManager.FREE_TIER_LIMIT.toLocaleString()} tokens (${usagePercent}%) ${status}`);
        });

        if (successful.length === 0) {
            console.error("\n❌ All mock test generations failed!");
            console.error("This is likely due to quota limits. Try the suggestions above.");
            process.exit(1);
        }

        console.log(`\n🎉 Successfully generated ${successful.length} mock test(s) with enhanced quota management!`);

        // Final recommendations
        if (successful.length < numberOfMocks) {
            console.log(`\n💡 To improve success rate:`);
            console.log(`  1. Add more API keys to distribute load`);
            console.log(`  2. Reduce reference material size`);
            console.log(`  3. Use smaller models like gemini-2.5-flash instead of pro`);
            console.log(`  4. Run generations with longer delays between requests`);
        }

    } catch (error) {
        console.error("\n❌ An unexpected error occurred in enhanced mode:");
        console.error(`- ${error.message}`);
        console.error("\nStack trace:");
        console.error(error.stack);
        process.exit(1);
    }
}

// Additional utility functions to add to your script

// Enhanced file size utilities
async function getOptimizedFileInfo(filePath) {
    try {
        const stats = await fs.stat(filePath);
        const sizeInMB = stats.size / (1024 * 1024);

        return {
            path: filePath,
            size: stats.size,
            sizeMB: sizeInMB,
            basename: path.basename(filePath),
            isLarge: sizeInMB > 10, // Flag files over 10MB
            estimatedTokens: Math.ceil(stats.size / 2) // Rough estimate for PDF content
        };
    } catch (error) {
        console.warn(`Warning: Could not analyze file ${filePath}`);
        return null;
    }
}

// Smart file selection based on size and importance
async function selectOptimalFiles(filePaths, maxTotalTokens = 80000) {
    const fileInfos = await Promise.all(
        filePaths.map(fp => getOptimizedFileInfo(fp))
    );

    const validFiles = fileInfos.filter(info => info !== null);

    // Sort by size (smaller first) and select up to token limit
    validFiles.sort((a, b) => a.size - b.size);

    const selectedFiles = [];
    let totalTokens = 0;

    for (const fileInfo of validFiles) {
        if (totalTokens + fileInfo.estimatedTokens <= maxTotalTokens) {
            selectedFiles.push(fileInfo.path);
            totalTokens += fileInfo.estimatedTokens;
        } else {
            console.log(`📊 Skipping ${fileInfo.basename} (${fileInfo.estimatedTokens.toLocaleString()} tokens) - would exceed limit`);
        }
    }

    console.log(`📊 Selected ${selectedFiles.length}/${validFiles.length} files (${totalTokens.toLocaleString()} estimated tokens)`);
    return selectedFiles;
}

// Replace the original main() call with:
// enhancedMain().catch(error => {
//     console.error('Fatal error in enhanced mode:', error);
//     process.exit(1);
// });
