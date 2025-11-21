import { GoogleGenAI } from "@google/genai";
import { program } from "commander";
import * as fs from "fs/promises";
import * as path from "path";
import puppeteer from "puppeteer";
import PptxGenJS from 'pptxgenjs';

// --- UPDATED SYSTEM PROMPT FOR JSON OUTPUT ---
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

// --- JSON TO HTML CONVERSION ---
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
        
        /* Directions */
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
        }
        
        /* Questions */
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
        
        /* SVG Container */
        .svg-container {
            display: flex;
            justify-content: center;
            align-items: center;
            margin: 16px 0;
            page-break-inside: avoid;
        }
        
        .svg-container svg {
            border: 1px solid #e2e8f0;
            border-radius: 4px;
            background: #ffffff;
            max-width: 100%;
            height: auto;
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
        
        .answer-explanation {
            color: #2f855a;
            font-size: 14px;
            line-height: 1.5;
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
            
            .question {
                margin: 12px 0;
                padding: 12px;
            }
            
            .answer-solutions {
                margin: 24px 0;
                padding: 16px;
            }
        }
        
        /* Responsive Design */
        @media screen and (max-width: 768px) {
            body {
                padding: 10px;
                font-size: 13px;
            }
            
            .test-info {
                flex-direction: column;
                gap: 10px;
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

// --- JSON TO PPTX CONVERSION (using provided PPT script logic) ---
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

function svgToBase64(svgContent) {
    if (!svgContent || !svgContent.includes('<svg')) return null;
    const svgMatch = svgContent.match(/<svg[^>]*>[\s\S]*?<\/svg>/i);
    if (!svgMatch) return null;
    return `data:image/svg+xml;base64,${Buffer.from(svgMatch[0]).toString('base64')}`;
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

function createQuestionSlide(pptx, question, directions, bgImagePath) {
    const slide = addSlideWithBackground(pptx, bgImagePath);
    slide.addText(`Question ${question.questionNumber}`, { x: 0.5, y: 0.4, w: '90%', fontSize: 24, bold: true, color: '1A365D' });

    let currentY = 1.0;
    if (directions) {
        const cleanDirections = directions.text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        slide.addText(`Directions: ${cleanDirections}`, {
            x: 0.5, y: currentY, w: '90%', h: 1.5,
            fontSize: 12, italic: true, color: '555555', fill: { color: 'E2E8F0' }, margin: 10
        });
        currentY += 1.7;
    }
    const questionTextHeight = question.questionText.length > 200 ? 1.5 : 1;
    slide.addText(convertHtmlToPptxRichText(question.questionText), {
        x: 0.5, y: currentY, w: '90%', h: questionTextHeight, fontSize: 16
    });
    currentY += questionTextHeight + 0.2;

    if (question.svg) {
        const base64Svg = svgToBase64(question.svg);
        if (base64Svg) {
            slide.addImage({ data: base64Svg, x: 3, y: currentY, w: 4, h: 2 });
            currentY += 2.2;
        }
    }
    question.options.forEach(opt => {
        const optionText = `${opt.label}) ${opt.text || ''}`;
        if (opt.svg) {
            slide.addText(`${opt.label})`, { x: 0.75, y: currentY, w: 0.5, h: 0.5, fontSize: 14 });
            const base64Svg = svgToBase64(opt.svg);
            if (base64Svg) slide.addImage({ data: base64Svg, x: 1.25, y: currentY - 0.25, w: 1, h: 1 });
            currentY += 1.2;
        } else {
            slide.addText(optionText, { x: 0.75, y: currentY, w: '85%', h: 0.3, fontSize: 14 });
            currentY += 0.4;
        }
    });
}

function createAnswerSlide(pptx, question, bgImagePath) {
    const slide = addSlideWithBackground(pptx, bgImagePath);
    slide.addText(`Answer & Solution: Q${question.questionNumber}`, { x: 0.5, y: 0.4, w: '90%', fontSize: 24, bold: true, color: '1A365D' });

    slide.addText(question.solution.answer, {
        x: 0.5, y: 1.0, w: '90%', h: 0.4,
        fontSize: 18, bold: true, color: '008000',
    });
    const explanationText = question.solution.explanation.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    const hasSvg = question.solution.svg && svgToBase64(question.solution.svg);
    slide.addText(explanationText, {
        x: 0.5, y: 1.6, w: hasSvg ? '50%' : '90%', h: 3.8, fontSize: 12,
    });
    if (hasSvg) {
        slide.addImage({ data: svgToBase64(question.solution.svg), x: 5.5, y: 1.8, w: 4, h: 3, });
    }
}

async function generatePptFromJson(jsonData, outputPath, backgroundPath) {
    try {
        console.log('📊 Creating PowerPoint presentation...');
        
        const pptx = new PptxGenJS();
        
        // Create slides
        createTitleSlide(pptx, jsonData, backgroundPath);
        createInstructionsSlide(pptx, jsonData, backgroundPath);

        // Collect all questions
        const allQuestions = [];
        jsonData.sections.forEach(section => {
            section.questionSets.forEach(qSet => {
                const directions = qSet.type === 'group' ? qSet.directions : null;
                qSet.questions.forEach(q => allQuestions.push({ ...q, directions }));
            });
        });

        // Create question slides
        console.log('📝 Creating question slides...');
        allQuestions.forEach(q => createQuestionSlide(pptx, q, q.directions, backgroundPath));

        // Add answers divider slide
        const answerTitleSlide = addSlideWithBackground(pptx, backgroundPath);
        answerTitleSlide.addText('Answers & Solutions', { 
            x: 0, y: '45%', w: '100%', align: 'center', 
            fontSize: 44, color: '003B75', bold: true 
        });

        // Create answer slides
        console.log('✅ Creating answer slides...');
        allQuestions.forEach(q => createAnswerSlide(pptx, q, backgroundPath));

        // Save the presentation
        await pptx.writeFile({ fileName: outputPath });
        console.log(`📊 PowerPoint generated successfully: ${path.basename(outputPath)}`);
        
    } catch (error) {
        console.error(`❌ PowerPoint generation failed: ${error.message}`);
        throw error;
    }
}

// --- PDF GENERATION FROM HTML ---
async function generatePdf(htmlContent, outputPath) {
    let browser = null;
    try {
        console.log('📄 Launching browser for PDF generation...');
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
    
    if (options.temperature && options.temperature !== 1 ) {
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

// --- MAIN MOCK GENERATION FUNCTION (updated for JSON) ---
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

            // Convert JSON to HTML
            console.log(`🔄 Converting JSON to HTML for mock ${mockNumber}...`);
            const htmlContent = convertJsonToHtml(jsonData);

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

            // Generate PDF
            console.log(`📄 Converting to PDF: ${path.basename(outputPath)}`);
            await generatePdf(htmlContent, outputPath);

            // Generate PPT if requested
            if (options.ppt) {
                const pptOutputPath = generateOutputFilename(options.output, mockNumber, totalMocks, '.pptx');
                const backgroundPath = options.pptBackground || null;
                await generatePptFromJson(jsonData, pptOutputPath, backgroundPath);
            }
            
            // Update usage stats
            apiKeyManager.incrementUsage(currentKeyInfo.index);
            
            console.log(`✅ Mock ${mockNumber}/${totalMocks} completed with API Key ${currentKeyInfo.index + 1}: ${path.basename(outputPath)}`);
            console.log(`📄 Generated content length: ${generatedJson.length} characters`);
            
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

// Complete enhanced main function - replace the original main() function with this
async function enhancedMain() {
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
        .parse(process.argv);

    const options = program.opts();
    const apiKeyFile = options.apiKeyFile || "api_key.txt";
    const numberOfMocks = parseInt(options.numberOfMocks) || 1;
    const maxConcurrent = options.concurrentLimit || 4;
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
        console.log("🔧 Initializing enhanced quota management...");

        // 1. Validate directories first
        console.log("Validating directories...");
        await validateDirectories(options.pyq, options.referenceMock);

        // 2. Set up the Enhanced API Key Manager
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

        // Replace ApiKeyManager with TokenAwareApiKeyManager
        apiKeyManager = new TokenAwareApiKeyManager(apiKeys);

        // Initialize content optimizer
        const contentOptimizer = new ContentOptimizer(100000); // 100k tokens max per request
        console.log("🔧 Content optimizer initialized with 100k token limit per request");

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

        // Use optimized file processing with smaller chunks
        console.log("🔄 Optimizing PDF content for token limits...");
        const pyqParts = await contentOptimizer.filesToOptimizedParts(pyqFiles, "PYQ", 10 * 1024 * 1024); // 10MB chunks
        const refMockParts = await contentOptimizer.filesToOptimizedParts(refMockFiles, "Reference Mock", 10 * 1024 * 1024);

        if (pyqParts.length === 0 && refMockParts.length === 0) {
            console.error("\nError: No valid PDF files could be processed. Aborting.");
            process.exit(1);
        }

        console.log(`📊 Processed ${pyqParts.length} PYQ parts and ${refMockParts.length} reference mock parts`);

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
            console.error("Try reducing the size or number of reference PDF files.");
            process.exit(1);
        }

        console.log(`✅ Created ${requestVariants.length} optimized request variants`);

        // 6. Generate mock tests with enhanced strategy
        console.log(`\n🚀 Starting generation of ${numberOfMocks} mock test(s) with quota optimization...`);
        let outputFormats = ["JSON", "PDF"];
        if (options.ppt) outputFormats.push("PowerPoint");
        console.log(`📄 Output Formats: ${outputFormats.join(', ')}`);
        console.log(`🤖 Using model: ${options.model}`);
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
        console.log(`🔄 Using smart concurrency limit: ${smartConcurrentLimit} (reduced from ${maxConcurrent})`);
        console.log(`🔑 Available API keys: ${apiKeyManager.apiKeys.length}`);

        const results = [];
        for(let i = 0; i < generationTasks.length; i += smartConcurrentLimit) {
            const batchNumber = Math.floor(i/smartConcurrentLimit) + 1;
            const totalBatches = Math.ceil(generationTasks.length/smartConcurrentLimit);
            console.log(`\n📦 Processing batch ${batchNumber}/${totalBatches} (mocks ${i+1}-${Math.min(i+smartConcurrentLimit, generationTasks.length)})`);

            const batch = generationTasks.slice(i, i + smartConcurrentLimit).map(task => task());
            const batchResults = await Promise.allSettled(batch);
            results.push(...batchResults);

            // Add inter-batch delay to prevent quota exhaustion
            if (i + smartConcurrentLimit < generationTasks.length) {
                console.log(`⏳ Inter-batch cooling period: 30 seconds to prevent quota exhaustion...`);
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
                const isQuotaError = error?.message?.includes('quota') ||
                                   error?.message?.includes('RESOURCE_EXHAUSTED') ||
                                   error?.message?.includes('429');
                const errorType = isQuotaError ? '[QUOTA]' : '[ERROR]';
                console.log(`  ${errorType} ${path.basename(outputPath)}: ${error?.message || 'Unknown error'}`);
            });

            // Provide actionable advice
            const quotaErrors = failed.filter(result => {
                const error = result.reason || result.value?.error;
                return error?.message?.includes('quota') ||
                       error?.message?.includes('RESOURCE_EXHAUSTED') ||
                       error?.message?.includes('429');
            });

            if (quotaErrors.length > 0) {
                console.log(`\n💡 Quota Management Suggestions:`);
                console.log(`  - ${quotaErrors.length} failures were quota-related`);
                console.log(`  - Consider adding more API keys to ${apiKeyFile}`);
                console.log(`  - Try reducing the number of reference PDF files`);
                console.log(`  - Consider upgrading to a paid Gemini API plan for higher quotas`);
                console.log(`  - Increase delays with --rate-limit-delay 5000 or higher`);
                console.log(`  - Use --model gemini-2.5-flash instead of gemini-2.5-pro (better quota)`);
            }
        }

        // Token usage summary
        console.log(`\n📊 Token Usage Summary:`);
        apiKeyManager.apiKeys.forEach((key, index) => {
            const usage = apiKeyManager.tokenUsagePerMinute.get(index) || 0;
            const usagePercent = ((usage / apiKeyManager.FREE_TIER_LIMIT) * 100).toFixed(1);
            const status = apiKeyManager.failedKeys.has(index) ? '❌ FAILED' : '✅ ACTIVE';
            const keyPreview = `${key.substring(0, 8)}...${key.substring(key.length - 4)}`;
            console.log(`  Key ${index + 1} (${keyPreview}): ${usage.toLocaleString()}/${apiKeyManager.FREE_TIER_LIMIT.toLocaleString()} tokens (${usagePercent}%) ${status}`);
        });

        // Show quota reset times
        const now = Date.now();
        console.log(`\n⏰ Quota Reset Information:`);
        apiKeyManager.apiKeys.forEach((key, index) => {
            if (!apiKeyManager.failedKeys.has(index)) {
                const lastReset = apiKeyManager.lastResetTime.get(index) || 0;
                const nextReset = lastReset + 60000; // 1 minute from last reset
                const timeToReset = Math.max(0, nextReset - now);
                if (timeToReset > 0) {
                    console.log(`  Key ${index + 1}: Next reset in ${Math.ceil(timeToReset/1000)} seconds`);
                } else {
                    console.log(`  Key ${index + 1}: Ready for use (quota reset)`);
                }
            }
        });

        if (successful.length === 0) {
            console.error("\n❌ All mock test generations failed!");
            console.error("This is likely due to quota limits. Try the suggestions above.");
            process.exit(1);
        }

        console.log(`\n🎉 Successfully generated ${successful.length} mock test(s) with enhanced quota management!`);

        // Final recommendations based on results
        if (successful.length < numberOfMocks) {
            console.log(`\n💡 To improve success rate for future runs:`);
            console.log(`  1. Add more API keys to ${apiKeyFile} (one per line)`);
            console.log(`  2. Reduce reference material size by selecting fewer/smaller PDF files`);
            console.log(`  3. Use gemini-2.5-flash model instead of pro (--model gemini-2.5-flash)`);
            console.log(`  4. Run with longer delays (--rate-limit-delay 5000)`);
            console.log(`  5. Use lower concurrency (--concurrent-limit 1)`);
            console.log(`  6. Consider upgrading to paid API for higher quotas`);
        } else {
            console.log(`\n🚀 Perfect success rate! Your configuration is working optimally.`);
        }

        // Performance metrics
        if (successful.length > 0) {
            const avgTimePerMock = totalTime / successful.length;
            const totalTokensUsed = successful.reduce((sum, result) => {
                return sum + (result.usage?.promptTokenCount || 0);
            }, 0);

            console.log(`\n📈 Performance Metrics:`);
            console.log(`  - Average time per mock: ${avgTimePerMock.toFixed(2)} seconds`);
            console.log(`  - Total input tokens used: ${totalTokensUsed.toLocaleString()}`);
            console.log(`  - Tokens per mock average: ${Math.round(totalTokensUsed / successful.length).toLocaleString()}`);
        }

    } catch (error) {
        console.error("\n❌ An unexpected error occurred in enhanced mode:");
        console.error(`- ${error.message}`);

        // Show stack trace only in debug mode
        if (process.env.DEBUG || process.argv.includes('--debug')) {
            console.error("\nStack trace:");
            console.error(error.stack);
        } else {
            console.error("\nFor detailed error information, run with DEBUG=1 or --debug");
        }

        console.error("\n🔧 Troubleshooting tips:");
        console.error("- Verify all PDF files are accessible and not corrupted");
        console.error("- Check that all API keys in the key file are valid");
        console.error("- Ensure you have sufficient disk space for output files");
        console.error("- Try running with fewer mocks first to test the setup");

        process.exit(1);
    }
}

// Additional utility functions for the enhanced version

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
        console.warn(`Warning: Could not analyze file ${filePath}: ${error.message}`);
        return null;
    }
}

// Smart file selection based on size and importance
async function selectOptimalFiles(filePaths, maxTotalTokens = 80000) {
    const fileInfos = await Promise.all(
        filePaths.map(fp => getOptimizedFileInfo(fp))
    );

    const validFiles = fileInfos.filter(info => info !== null);

    if (validFiles.length === 0) {
        console.warn("No valid files found for optimization");
        return [];
    }

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

// Export the enhanced main function for use
// Replace the original main() call at the end of your script with:
// enhancedMain().catch(error => {
//     console.error('Fatal error in enhanced mode:', error);
//     process.exit(1);
// });

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
enhancedMain().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
