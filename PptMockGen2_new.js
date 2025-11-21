import { GoogleGenAI } from "@google/genai";
import { program } from "commander";
import * as fs from "fs/promises";
import * as path from "path";
import PptxGenJS from 'pptxgenjs';

const systemPrompt = `You are an expert exam question generator specializing in MBACET (MAH-MBA-CET) mock tests. Your task is to generate high-quality questions by analyzing reference mock tests and creating similar variants.

CRITICAL RULES:

1. **Analyze Reference Materials:**
   - Study the reference mock test TXT files to understand question patterns, difficulty levels, and formats
   - Identify question types: Logical Reasoning (LR), Quantitative Aptitude (QUANT), and Abstract Reasoning
   - Note the structure, language style, and complexity of questions

2. **Generate Question Variants:**
   - Create NEW questions that are SIMILAR in structure but use DIFFERENT numbers, names, scenarios
   - For LR: Change names of people, objects, colors, positions, but keep the logical structure
   - For QUANT: Change numbers, values, percentages, but keep the mathematical concept
   - For Abstract Reasoning: Create new visual patterns following similar transformation rules
   - Maintain the same difficulty level as the reference questions

3. **Question Distribution:**
   - Generate exactly 75 Logical Reasoning questions (Q1-Q75)
   - Generate exactly 50 Quantitative Aptitude questions (Q76-Q125)
   - Generate exactly 25 Abstract Reasoning questions (Q126-Q150)
   - Total: 150 questions

4. **JSON Output Format:**
   Output valid JSON with this structure:
   {
     "examTitle": "MBACET Mock Test",
     "examDetails": {
       "totalQuestions": 150,
       "timeAllotted": "150 Minutes",
       "maxMarks": 150
     },
     "instructions": {
       "title": "Instructions",
       "points": ["Each question carries 1 mark", "There is no negative marking"]
     },
     "sections": [
       {
         "sectionTitle": "Logical Reasoning",
         "questionSets": [...]
       },
       {
         "sectionTitle": "Quantitative Aptitude", 
         "questionSets": [...]
       },
       {
         "sectionTitle": "Abstract Reasoning",
         "questionSets": [...]
       }
     ]
   }

5. **Abstract Reasoning Format with problemFigures:**
   {
     "questionNumber": "126",
     "questionText": "Find the next figure in the series:",
     "problemFigures": [
       "<svg viewBox='0 0 100 100'><circle cx='50' cy='50' r='20' fill='black'/></svg>",
       "<svg viewBox='0 0 100 100'><circle cx='50' cy='50' r='30' fill='black'/></svg>",
       "<svg viewBox='0 0 100 100'><circle cx='50' cy='50' r='40' fill='black'/></svg>",
       "<svg viewBox='0 0 100 100'><text x='50' y='55' text-anchor='middle' font-size='30'>?</text></svg>"
     ],
     "options": [
       {"label": "A", "text": "", "svg": "<svg viewBox='0 0 100 100'>...</svg>"}
     ],
     "solution": {
       "answer": "Option (A)",
       "steps": ["Step 1", "Step 2"]
     }
   }

CRITICAL: Output ONLY valid JSON. No markdown, no explanations.`;

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
                options: { bold: isBold, fontSize: 11, fontFace: 'Calibri' } 
            });
        }
    });
    
    return richText.length > 0 ? richText : [{ text: textWithNewlines }];
}

function svgToBase64(svgContent, preserveAspect = false) {
    if (!svgContent || typeof svgContent !== 'string' || !svgContent.includes('<svg')) return null;

    const svgMatch = svgContent.match(/<svg[^>]*>[\s\S]*?<\/svg>/i);
    if (!svgMatch) return null;

    let svgString = svgMatch[0];

    if (!/viewBox=/i.test(svgString)) {
        svgString = svgString.replace('<svg', '<svg viewBox="0 0 100 100"');
    }

    if (preserveAspect) {
        if (!/preserveAspectRatio=/i.test(svgString)) {
            svgString = svgString.replace('<svg', '<svg preserveAspectRatio="xMidYMid meet"');
        }
        svgString = svgString.replace(/ width="[^"]*"/i, '').replace(/ height="[^"]*"/i, '');
    }

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
        x: 0.5, y: 1.5, w: '90%', h: 1, 
        fontSize: 40, bold: true, color: '003B75', align: 'center',
    });
    const detailsText = `Total Questions: ${data.examDetails.totalQuestions}  |  Time: ${data.examDetails.timeAllotted}  |  Max Marks: ${data.examDetails.maxMarks}`;
    slide.addText(detailsText, {
        x: 0.5, y: 3.0, w: '90%', h: 0.5, 
        fontSize: 20, color: '333333', align: 'center',
    });
}

function createInstructionsSlide(pptx, data, bgImagePath) {
    const slide = addSlideWithBackground(pptx, bgImagePath);
    slide.addText(data.instructions.title, { 
        x: 0.5, y: 0.5, w: '90%', 
        fontSize: 32, bold: true, color: '2B6CB0' 
    });
    const instructionPoints = data.instructions.points.map(point => ({ 
        text: point, 
        options: { fontSize: 16, bullet: true, paraSpcAfter: 10 } 
    }));
    slide.addText(instructionPoints, {
        x: 0.75, y: 1.5, w: '85%', h: 4,
    });
}

function createDirectionsSlide(pptx, directions, bgImagePath) {
    const slide = addSlideWithBackground(pptx, bgImagePath);
    let currentY = 0.3;

    if (directions.title) {
        slide.addText(directions.title, {
            x: 0.3, y: currentY, w: '94%', h: 0.4,
            fontSize: 16, bold: true, color: '1A365D'
        });
        currentY += 0.6;
    }
    
    if (directions.text) {
        const textHeight = Math.max(0.5, Math.ceil(directions.text.replace(/<[^>]*>/g, '').length / 120) * 0.4);
        slide.addText(convertHtmlToPptxRichText(directions.text), {
            x: 0.3, y: currentY, w: '94%', h: textHeight,
            fontSize: 12, color: '333333', wrap: true
        });
        currentY += textHeight + 0.3;
    }

    if (directions.svg) {
        const base64Svg = svgToBase64(directions.svg);
        if (base64Svg) {
            slide.addText("Example:", { x: 0.5, y: currentY, w: '90%', h: 0.3, fontSize: 12, fontFace: 'Calibri', color: '333333' });
            currentY += 0.4;
            slide.addImage({ 
                data: base64Svg, 
                x: 1, y: currentY, w: 8, h: 3, 
                sizing: { type: 'contain', w: 8, h: 3 } 
            });
        }
    }
}

function createAbstractReasoningQuestionSlide(pptx, question, bgImagePath) {
    const slide = addSlideWithBackground(pptx, bgImagePath);

    slide.addText(`Question ${question.questionNumber}`, { 
        x: 0.3, y: 0.2, w: '90%', h: 0.4,
        fontSize: 12, fontFace: 'Calibri', bold: true, color: '1A365D'
    });
    slide.addText(question.questionText, {
        x: 0.3, y: 0.5, w: '94%', h: 0.5,
        fontSize: 11, fontFace: 'Calibri'
    });

    if (question.problemFigures && question.problemFigures.length > 0) {
        const problemFigY = 1.2;
        const problemFigH = 1.8;
        const totalWidth = 9.5;
        const numFigs = question.problemFigures.length;
        const figWidth = Math.min(1.8, totalWidth / numFigs * 0.9);
        const spacing = (totalWidth - (numFigs * figWidth)) / numFigs;
        let currentX = 0.25 + spacing / 2;

        question.problemFigures.forEach((figSvg) => {
            const base64Svg = svgToBase64(figSvg, true);
            if (base64Svg) {
                slide.addImage({
                    data: base64Svg, x: currentX, y: problemFigY, w: figWidth, h: problemFigH,
                    sizing: { type: 'contain', w: figWidth, h: problemFigH }
                });
            }
            currentX += figWidth + spacing;
        });
    }

    slide.addShape(pptx.shapes.LINE, { x: 0.25, y: 3.8, w: 9.5, h: 0, line: { color: 'C0C0C0', width: 1 } });

    const options = question.options || [];
    const optY = 4.2;
    const optH = 1.2;
    const totalOptWidth = 9.5;
    const numOpts = options.length;
    const optW = Math.min(1.5, totalOptWidth / numOpts * 0.85);
    const optSpacing = (totalOptWidth - (numOpts * optW)) / (numOpts + 1);
    let currentOptX = 0.25 + optSpacing;

    options.forEach((opt) => {
        slide.addText(opt.label, {
            x: currentOptX, y: optY - 0.35, w: optW, h: 0.3,
            align: 'center', fontSize: 11, bold: true
        });
        
        const base64Svg = svgToBase64(opt.svg, true);
        if (base64Svg) {
            slide.addImage({
                data: base64Svg, x: currentOptX, y: optY, w: optW, h: optH,
                sizing: { type: 'contain', w: optW, h: optH }
            });
        }
        currentOptX += optW + optSpacing;
    });
}

function createGenericQuestionSlide(pptx, question, bgImagePath) {
    const slide = addSlideWithBackground(pptx, bgImagePath);

    slide.addText(`Question ${question.questionNumber}`, { 
        x: 0.3, y: 0.2, w: '90%', h: 0.4,
        fontSize: 12, fontFace: 'Calibri', bold: true, color: '1A365D'
    });

    let currentY = 0.7;

    const questionTextHeight = Math.max(1.0, Math.ceil(question.questionText.length / 150) * 0.5);
    slide.addText(convertHtmlToPptxRichText(question.questionText), {
        x: 0.3, y: currentY, w: '90%', h: questionTextHeight,
        fontSize: 11, fontFace: 'Calibri', wrap: true
    });
    currentY += questionTextHeight + 0.3;

    if (question.svg) {
        const base64Svg = svgToBase64(question.svg);
        if (base64Svg) {
            const remainingHeight = 5.0 - currentY;
            const imageHeight = Math.min(3, remainingHeight);
            const imageWidth = imageHeight * 1.33;
            slide.addImage({ 
                data: base64Svg, x: (10 - imageWidth) / 2, y: currentY, 
                w: imageWidth, h: imageHeight, sizing: { type: 'contain' }
            });
            currentY += imageHeight + 0.3;
        }
    }

    const optionsPerRow = question.options.some(opt => opt.svg) ? 2 : 1;
    const optionWidth = optionsPerRow === 2 ? '42%' : '85%';
    question.options.forEach((opt, index) => {
        const isNewLine = index % optionsPerRow === 0;
        const optionX = isNewLine ? 0.5 : 5.2;

        if (!isNewLine) {
           currentY -= 0.35;
        }

        const optionText = `${opt.label}) ${opt.text || ''}`;
        
        slide.addText(optionText, { 
            x: optionX, y: currentY, w: optionWidth, h: 0.3, 
            fontSize: 10, fontFace: 'Calibri'
        });

        if(index % optionsPerRow === optionsPerRow - 1) {
            currentY += 0.35;
        }
    });
}

function createQuestionSlide(pptx, question, bgImagePath) {
    if (question.problemFigures && Array.isArray(question.problemFigures) && question.problemFigures.length > 0) {
        createAbstractReasoningQuestionSlide(pptx, question, bgImagePath);
    } else {
        createGenericQuestionSlide(pptx, question, bgImagePath);
    }
}

function createAnswerSlide(pptx, question, bgImagePath) {
    const slide = addSlideWithBackground(pptx, bgImagePath);

    slide.addText(`Answer & Solution: Q${question.questionNumber}`, {
        x: 0.3, y: 0.3, w: '90%',
        fontSize: 14, fontFace: 'Calibri', bold: true, color: '1A365D'
    });

    slide.addText(`Correct Answer: ${question.solution.answer}`, {
        x: 0.3, y: 0.8, w: '90%', h: 0.4,
        fontSize: 12, fontFace: 'Calibri', bold: true, color: '2E7D32'
    });

    let currentY = 1.4;
    if (question.solution.steps && question.solution.steps.length > 0) {
        slide.addText('Solution:', {
            x: 0.3, y: currentY, w: '90%', h: 0.3,
            fontSize: 11, fontFace: 'Calibri', bold: true
        });
        currentY += 0.4;
        
        const richTextSteps = question.solution.steps.map(step => ({ 
            text: step, 
            options: { 
                bullet: { code: '2022' }, 
                fontSize: 10, 
                fontFace: 'Calibri', 
                paraSpcAfter: 8 
            } 
        }));
        slide.addText(richTextSteps, {
             x: 0.5, y: currentY, w: '88%', h: 3.5, color: '424242' 
        });
    }
}

async function generatePptFromJson(jsonData, outputPath, backgroundPath) {
    try {
        console.log('Creating PowerPoint presentation...');
        const pptx = new PptxGenJS();
        
        createTitleSlide(pptx, jsonData, backgroundPath);
        createInstructionsSlide(pptx, jsonData, backgroundPath);

        jsonData.sections.forEach(section => {
            section.questionSets.forEach(qSet => {
                if (qSet.type === 'group' && qSet.directions) {
                    createDirectionsSlide(pptx, qSet.directions, backgroundPath);
                }
                
                qSet.questions.forEach(q => {
                    createQuestionSlide(pptx, q, backgroundPath);
                });
            });
        });

        const answerTitleSlide = addSlideWithBackground(pptx, backgroundPath);
        answerTitleSlide.addText('Answers & Solutions', { 
            x: 0, y: '45%', w: '100%', align: 'center', 
            fontSize: 44, color: '003B75', bold: true 
        });

        jsonData.sections.forEach(section => {
            section.questionSets.forEach(qSet => {
                qSet.questions.forEach(q => {
                    createAnswerSlide(pptx, q, backgroundPath);
                });
            });
        });

        await pptx.writeFile({ fileName: outputPath });
        console.log(`PowerPoint generated: ${path.basename(outputPath)}`);
        
    } catch (error) {
        console.error(`PowerPoint generation failed: ${error.message}`);
        throw error;
    }
}

function mergePartialJsonResponses(jsonParts) {
    console.log(`Merging ${jsonParts.length} JSON parts...`);
    
    if (jsonParts.length === 1) {
        return jsonParts[0];
    }

    const mergedData = JSON.parse(JSON.stringify(jsonParts[0]));
    
    for (let i = 1; i < jsonParts.length; i++) {
        const currentPart = jsonParts[i];
        
        if (currentPart.sections && Array.isArray(currentPart.sections)) {
            currentPart.sections.forEach(newSection => {
                const existingSection = mergedData.sections.find(s => s.sectionTitle === newSection.sectionTitle);
                
                if (existingSection) {
                    if (newSection.questionSets) {
                        existingSection.questionSets = existingSection.questionSets || [];
                        existingSection.questionSets.push(...newSection.questionSets);
                    }
                } else {
                    mergedData.sections.push(newSection);
                }
            });
        }
    }
    
    console.log(`Merged JSON successfully. Total sections: ${mergedData.sections.length}`);
    return mergedData;
}

async function generateWithContinuation(genAI, contents, options) {
    const allResponses = [];
    let continuationNeeded = true;
    let attemptCount = 0;
    const maxAttempts = 5;
    
    while (continuationNeeded && attemptCount < maxAttempts) {
        attemptCount++;
        console.log(`Generation attempt ${attemptCount}/${maxAttempts}...`);
        
        try {
            const generationConfig = createGenerationConfig(options, options.model);
            
            const requestParams = {
                model: options.model,
                contents: contents
            };
            
            if (Object.keys(generationConfig).length > 0) {
                requestParams.generationConfig = generationConfig;
            }
            
            const response = await genAI.models.generateContent(requestParams);
            
            if (!response || !response.text) {
                throw new Error("No response received from API");
            }
            
            const generatedText = response.text.trim();
            
            if (response.usageMetadata) {
                const usage = response.usageMetadata;
                console.log(`Token usage - Input: ${usage.promptTokenCount || 'N/A'}, Output: ${usage.candidatesTokenCount || 'N/A'}`);
            }
            
            let cleanJson = generatedText;
            if (cleanJson.startsWith('```json')) {
                cleanJson = cleanJson.replace(/^```json\s*/, '').replace(/\s*```$/, '');
            } else if (cleanJson.startsWith('```')) {
                cleanJson = cleanJson.replace(/^```\s*/, '').replace(/\s*```$/, '');
            }
            
            let jsonData;
            try {
                jsonData = JSON.parse(cleanJson);
                allResponses.push(jsonData);
                
                let totalQuestions = 0;
                if (jsonData.sections) {
                    jsonData.sections.forEach(section => {
                        section.questionSets?.forEach(qSet => {
                            totalQuestions += qSet.questions?.length || 0;
                        });
                    });
                }
                
                console.log(`Current total questions: ${totalQuestions}/150`);
                
                if (totalQuestions >= 150) {
                    console.log('All 150 questions generated successfully!');
                    continuationNeeded = false;
                } else {
                    console.log(`Need ${150 - totalQuestions} more questions. Requesting continuation...`);
                    
                    contents.push({
                        text: `Continue generating the remaining ${150 - totalQuestions} questions. Start from question ${totalQuestions + 1}. Output valid JSON that can be merged with the previous response.`
                    });
                }
                
            } catch (parseError) {
                console.error(`Failed to parse JSON on attempt ${attemptCount}: ${parseError.message}`);
                
                await fs.writeFile(`debug_attempt_${attemptCount}.txt`, cleanJson);
                console.log(`Saved debug output to debug_attempt_${attemptCount}.txt`);
                
                if (attemptCount < maxAttempts) {
                    console.log('Retrying with clarification prompt...');
                    contents.push({
                        text: 'The previous response was not valid JSON. Please provide a valid JSON response that follows the exact schema specified.'
                    });
                } else {
                    throw new Error('Max attempts reached. Could not generate valid JSON.');
                }
            }
            
        } catch (error) {
            console.error(`Error on attempt ${attemptCount}:`, error.message);
            if (attemptCount >= maxAttempts) {
                throw error;
            }
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
    
    if (allResponses.length === 0) {
        throw new Error('No valid responses generated');
    }
    
    return allResponses.length === 1 ? allResponses[0] : mergePartialJsonResponses(allResponses);
}

class ApiKeyManager {
    constructor(apiKeys) {
        this.apiKeys = apiKeys.map(key => key.trim()).filter(key => key.length > 0);
        this.keyUsageCount = new Map();
        this.failedKeys = new Set();
        this.keyAssignments = new Map();
        
        this.apiKeys.forEach((key, index) => {
            this.keyUsageCount.set(index, 0);
        });
        
        console.log(`Loaded ${this.apiKeys.length} API keys`);
    }

    assignKeyToMock(mockNumber) {
        if (this.failedKeys.size === this.apiKeys.length) {
            throw new Error("All API keys have failed");
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

    markKeyAsFailed(keyIndex, error) {
        this.failedKeys.add(keyIndex);
        console.warn(`API key ${keyIndex + 1} marked as failed: ${error.message}`);
    }

    incrementUsage(keyIndex) {
        const currentCount = this.keyUsageCount.get(keyIndex) || 0;
        this.keyUsageCount.set(keyIndex, currentCount + 1);
    }
}

let apiKeyManager = null;

function validateThinkingBudget(budget, model) {
    if (budget === undefined) return null;
    const budgetNum = parseInt(budget);
    if (budgetNum === -1) return -1;
    if (budgetNum === 0) {
        if (model.includes('pro')) {
            console.warn("Warning: Thinking cannot be disabled for Gemini Pro models. Using minimum budget (128).");
            return 128;
        }
        return 0;
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
    }
    
    return config;
}

async function findTxtFiles(dirPath) {
    const txtFiles = [];
    try {
        const files = await fs.readdir(dirPath, { withFileTypes: true });
        for (const file of files) {
            const fullPath = path.join(dirPath, file.name);
            if (file.isDirectory()) {
                txtFiles.push(...(await findTxtFiles(fullPath)));
            } else if (path.extname(file.name).toLowerCase() === ".txt") {
                txtFiles.push(fullPath);
            }
        }
    } catch (error) {
        console.error(`Error reading directory '${dirPath}': ${error.message}`);
        throw error;
    }
    return txtFiles;
}

function generateOutputFilename(baseOutput, mockNumber, totalMocks, extension = '.pptx') {
    const baseName = path.basename(baseOutput, path.extname(baseOutput));
    const dir = path.dirname(baseOutput);
    
    if (totalMocks === 1) {
        return path.join(dir, baseName + extension);
    }
    
    const paddedNumber = String(mockNumber).padStart(String(totalMocks).length, '0');
    return path.join(dir, `${baseName}_${paddedNumber}${extension}`);
}

async function generateSingleMock(contents, outputPath, mockNumber, totalMocks, options) {
    const maxRetries = 3;
    let lastError = null;
    let currentKeyInfo = null;

    try {
        currentKeyInfo = apiKeyManager.assignKeyToMock(mockNumber);
        console.log(`Mock ${mockNumber}/${totalMocks} assigned to API Key ${currentKeyInfo.index + 1}`);
    } catch (error) {
        console.error(`Could not assign API key: ${error.message}`);
        return { success: false, error: error, outputPath: outputPath };
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const genAI = new GoogleGenAI({ apiKey: currentKeyInfo.key });
            console.log(`Mock ${mockNumber}/${totalMocks} - Attempt ${attempt}/${maxRetries}`);
            
            const jsonData = await generateWithContinuation(genAI, contents, options);
            
            if (!jsonData.examTitle || !jsonData.examDetails || !jsonData.sections) {
                throw new Error("Invalid JSON structure - missing required fields");
            }

            let totalQuestions = 0;
            jsonData.sections.forEach(section => {
                section.questionSets?.forEach(qSet => {
                    totalQuestions += qSet.questions?.length || 0;
                });
            });
            
            console.log(`Generated ${totalQuestions} questions total`);

            const outputDir = path.dirname(outputPath);
            if (outputDir !== '.') {
                await fs.mkdir(outputDir, { recursive: true });
            }

            if (options.saveJson) {
                const jsonPath = outputPath.replace('.pptx', '.json');
                await fs.writeFile(jsonPath, JSON.stringify(jsonData, null, 2));
                console.log(`JSON saved to: ${path.basename(jsonPath)}`);
            }

            console.log(`Generating PowerPoint: ${path.basename(outputPath)}`);
            await generatePptFromJson(jsonData, outputPath, options.pptBackground);
            
            apiKeyManager.incrementUsage(currentKeyInfo.index);
            
            console.log(`Mock ${mockNumber}/${totalMocks} completed successfully`);
            
            return {
                success: true,
                outputPath: outputPath,
                keyIndex: currentKeyInfo.index,
                totalQuestions: totalQuestions,
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

async function main() {
    program
        .requiredOption("--reference <dir>", "Directory containing reference mock test TXT files")
        .requiredOption("-o, --output <filename>", "Base output filename for generated PPTX")
        .option("--api-key-file <file>", "Path to API key file (default: api_key.txt)", "api_key.txt")
        .option("--number-of-mocks <number>", "Number of mock tests to generate (default: 1)", "1")
        .option("--max-tokens <number>", "Maximum output tokens per request (default: 8192)", parseInt, 8192)
        .option("--temperature <number>", "Temperature for response generation (0.0-2.0, default: 0.7)", parseFloat, 0.7)
        .option("--thinking-budget <number>", "Thinking budget tokens for internal reasoning")
        .option("--model <model>", "Gemini model to use (default: gemini-2.0-flash-exp)", "gemini-2.0-flash-exp")
        .option("--ppt-background <file>", "Background image file for PowerPoint slides")
        .option("--save-json", "Save the generated JSON to a file")
        .parse(process.argv);

    const options = program.opts();
    const numberOfMocks = parseInt(options.numberOfMocks) || 1;

    if (!numberOfMocks || isNaN(numberOfMocks) || numberOfMocks < 1) {
        console.error(`Error: --number-of-mocks must be a positive integer`);
        process.exit(1);
    }

    try {
        console.log(`Reading API keys from: ${options.apiKeyFile}`);
        const apiKeyContent = await fs.readFile(options.apiKeyFile, "utf-8");
        const apiKeys = apiKeyContent.split('\n')
            .map(key => key.trim())
            .filter(key => key.length > 0);
        
        if (apiKeys.length === 0) {
            throw new Error("No valid API keys found");
        }
        
        apiKeyManager = new ApiKeyManager(apiKeys);

        console.log("\nProcessing reference files...");
        const referenceFiles = await findTxtFiles(options.reference);
        console.log(`Found ${referenceFiles.length} reference TXT files`);

        if (referenceFiles.length === 0) {
            console.error("\nError: No TXT files found in reference directory");
            process.exit(1);
        }

        const referenceContents = [];
        for (const file of referenceFiles) {
            console.log(`Reading: ${path.basename(file)}`);
            const content = await fs.readFile(file, "utf-8");
            referenceContents.push({
                filename: path.basename(file),
                content: content
            });
        }

        const contents = [
            { text: systemPrompt },
            { text: "--- REFERENCE MOCK TEST FILES ---" }
        ];

        referenceContents.forEach(ref => {
            contents.push({ text: `\n=== ${ref.filename} ===\n${ref.content}` });
        });

        contents.push({ 
            text: "\n--- GENERATION TASK ---\nGenerate a complete MBACET mock test with 150 questions (75 LR + 50 QUANT + 25 Abstract Reasoning). Create variants of questions from the reference, changing numbers, names, and scenarios while maintaining structure and difficulty. Output valid JSON only." 
        });

        console.log(`\nStarting generation of ${numberOfMocks} mock test(s)...`);
        console.log(`Output Format: PowerPoint (PPTX)`);
        if (options.saveJson) {
            console.log("JSON files will also be saved");
        }
        
        const startTime = Date.now();
        const results = [];

        for (let i = 1; i <= numberOfMocks; i++) {
            const outputPath = generateOutputFilename(options.output, i, numberOfMocks, '.pptx');
            const result = await generateSingleMock(contents, outputPath, i, numberOfMocks, options);
            results.push(result);
        }
        
        const endTime = Date.now();
        const totalTime = (endTime - startTime) / 1000;

        const successful = results.filter(r => r.success);
        const failed = results.filter(r => !r.success);

        console.log(`\nGeneration Summary:`);
        console.log(`Successful: ${successful.length}/${numberOfMocks}`);
        console.log(`Failed: ${failed.length}/${numberOfMocks}`);
        console.log(`Total time: ${totalTime.toFixed(2)} seconds`);
        
        if (successful.length > 0) {
            console.log(`\nGenerated Files:`);
            successful.forEach(mockResult => {
                console.log(`  ${path.basename(mockResult.outputPath)} (${mockResult.totalQuestions} questions)`);
                if (options.saveJson) {
                    const jsonPath = mockResult.outputPath.replace('.pptx', '.json');
                    console.log(`  ${path.basename(jsonPath)}`);
                }
            });
        }

        if (failed.length > 0) {
            console.log(`\nFailed generations:`);
            failed.forEach(result => {
                console.log(`  - ${path.basename(result.outputPath)}: ${result.error?.message || 'Unknown error'}`);
            });
        }

        if (successful.length === 0) {
            console.error("\nAll mock test generations failed!");
            process.exit(1);
        }

        console.log(`\nSuccessfully generated ${successful.length} mock test(s)!`);

    } catch (error) {
        console.error("\nAn unexpected error occurred:");
        console.error(`- ${error.message}`);
        console.error("\nStack trace:");
        console.error(error.stack);
        process.exit(1);
    }
}

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection:', reason);
    process.exit(1);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    process.exit(1);
});

main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});