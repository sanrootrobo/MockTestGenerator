import { GoogleGenAI } from "@google/genai";
import { program } from "commander";
import * as fs from "fs/promises";
import * as path from "path";
import puppeteer from "puppeteer";
import PptxGenJS from 'pptxgenjs';

// --- VERBOSE ERROR LOGGING UTILITIES ---
class VerboseLogger {
    static logError(context, error, additionalInfo = {}) {
        console.error(`\n❌ ERROR in ${context}:`);
        console.error(`'─'.repeat(80)`);
        console.error(`📍 Message: ${error.message}`);
        console.error(`🔍 Error Type: ${error.constructor.name}`);
        if (error.code) console.error(`💾 System Code: ${error.code}`);
        Object.entries(additionalInfo).forEach(([key, value]) => {
            console.error(`📋 ${key}: ${JSON.stringify(value)}`);
        });
        if (error.stack) {
            console.error(`📚 Stack Trace:\n${error.stack.split('\n').map(line => `    ${line}`).join('\n')}`);
        }
        console.error(`⏰ Timestamp: ${new Date().toISOString()}`);
        console.error('─'.repeat(80) + '\n');
    }

    static logWarning(context, message, additionalInfo = {}) {
        console.warn(`\n⚠️  WARNING in ${context}:`);
        console.warn(`'─'.repeat(60)`);
        console.warn(`📍 Message: ${message}`);
        Object.entries(additionalInfo).forEach(([key, value]) => {
            console.warn(`📋 ${key}: ${JSON.stringify(value)}`);
        });
        console.warn(`⏰ Timestamp: ${new Date().toISOString()}`);
        console.warn('─'.repeat(60) + '\n');
    }

    static logApiError(error, context = {}) {
        const { mockNumber, attempt, keyIndex, model } = context;
        console.error(`\n🔥🔥🔥 API ERROR on Mock ${mockNumber}, Attempt ${attempt} (Key ${keyIndex + 1}) 🔥🔥🔥`);
        console.error('═'.repeat(80));
        console.error(`📍 Error Message: ${error.message}`);
        console.error(`🔍 Error Type:    ${error.constructor.name}`);
        console.error(`⏰ Timestamp:     ${new Date().toISOString()}`);
        console.error(`🤖 Model Used:    ${model}`);
        console.error('─'.repeat(40));

        let diagnosis = "An unknown API error occurred.";
        if (error.message.includes('quota') || (error.status === 429)) {
            diagnosis = "💰 QUOTA EXCEEDED: This API key has likely hit its usage limits.";
        } else if (error.message.includes('rate limit') || error.message.includes('RESOURCE_EXHAUSTED')) {
            diagnosis = "⏱️ RATE LIMIT: Too many requests sent too quickly.";
        } else if (error.message.includes('API key not valid') || error.status === 403) {
            diagnosis = "🔐 AUTHENTICATION FAILED: The API key is invalid or lacks permissions.";
        } else if (error.status === 400) {
             diagnosis = "👎 BAD REQUEST: The request was malformed (e.g., invalid parameter or input).";
        } else if (error.status === 500 || error.status === 503) {
             diagnosis = "🔧 SERVER ERROR: Google's servers encountered a temporary issue.";
        }
        console.error(`🩺 Diagnosis: ${diagnosis}`);
        console.error('─'.repeat(40));

        if (error.status || (error.response && error.response.status)) {
            console.error("📦 HTTP Response Details:");
            console.error(`   - Status Code: ${error.status || error.response.status}`);
            console.error(`   - Full Error Object:`, JSON.stringify(error, null, 2));
        }

        if (error.stack) console.error("📚 Stack Trace:\n" + error.stack);
        console.error('═'.repeat(80) + '\n');
    }
}

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
      "examTitle": "String",
      "examDetails": { "totalQuestions": Number, "timeAllotted": "String", "maxMarks": Number },
      "instructions": { "title": "String", "points": ["String"] },
      "sections": [
        {
          "sectionTitle": "String",
          "questionSets": [
            {
              "type": "group | single",
              "directions": { "title": "String", "text": "String" },
              "questions": [
                {
                  "questionNumber": "String",
                  "questionText": "String",
                  "svg": "String | null",
                  "options": [ { "label": "String", "text": "String", "svg": "String | null" } ],
                  "solution": { "answer": "String", "explanation": "String", "svg": "String | null" }
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
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Inter', sans-serif; line-height: 1.6; color: #2d3748; background-color: #ffffff; font-size: 14px; padding: 20px; }
        .test-header { text-align: center; margin-bottom: 32px; padding: 20px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border-radius: 12px; page-break-after: avoid; }
        .test-header h1 { color: white; font-size: 28px; font-weight: 700; margin-bottom: 8px; border: none; }
        .test-info { display: flex; justify-content: space-around; margin-top: 16px; font-size: 14px; }
        .test-info-item { text-align: center; }
        .test-info-label { font-weight: 300; opacity: 0.9; }
        .test-info-value { font-weight: 600; font-size: 16px; }
        .instructions { background: #fffaf0; border: 2px solid #fbd38d; border-radius: 8px; padding: 16px; margin: 16px 0; page-break-inside: avoid; }
        .instructions h2 { color: #c05621; font-size: 22px; font-weight: 600; margin: 0 0 12px 0; }
        .instructions ul { list-style-type: disc; margin-left: 20px; }
        .instructions li { margin: 8px 0; font-size: 14px; }
        .section-header { background: #f8f9fa; border: 2px solid #dee2e6; border-radius: 8px; padding: 15px 20px; margin: 25px 0 20px 0; text-align: center; page-break-after: avoid; }
        .section-title { font-size: 18px; font-weight: 600; color: #495057; margin: 0; }
        .directions { background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 6px; padding: 12px; margin: 16px 0; font-style: italic; color: #0c4a6e; }
        .directions-title { font-weight: 600; margin-bottom: 8px; }
        .question { background: #f7fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 16px 0; page-break-inside: avoid; }
        .question-number { font-weight: 600; color: #2b6cb0; font-size: 16px; }
        .question-text { margin: 8px 0 12px 0; font-size: 14px; line-height: 1.6; }
        .options { margin: 12px 0; }
        .option { display: block; margin: 6px 0; padding: 8px 12px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 4px; font-size: 13px; }
        .svg-container { display: flex; justify-content: center; align-items: center; margin: 16px 0; page-break-inside: avoid; }
        .svg-container svg { border: 1px solid #e2e8f0; border-radius: 4px; background: #ffffff; max-width: 100%; height: auto; }
        .answer-solutions { background: #f0fff4; border: 2px solid #38a169; border-radius: 8px; padding: 20px; margin: 32px 0; page-break-before: always; }
        .answer-solutions h2 { color: #22543d; font-size: 22px; font-weight: 600; margin-bottom: 16px; border-left: 4px solid #38a169; padding-left: 12px; }
        .answer-item { margin: 12px 0; padding: 12px; background: #ffffff; border-radius: 6px; border: 1px solid #c6f6d5; page-break-inside: avoid; }
        .answer-key { font-weight: 600; color: #22543d; font-size: 15px; margin-bottom: 8px; }
        .answer-explanation { color: #2f855a; font-size: 14px; line-height: 1.5; }
        @media print { body { font-size: 12px; padding: 10px; } .test-header h1 { font-size: 24px; } .question { margin: 12px 0; padding: 12px; } .answer-solutions { margin: 24px 0; padding: 16px; } }
        @media screen and (max-width: 768px) { body { padding: 10px; font-size: 13px; } .test-info { flex-direction: column; gap: 10px; } }
    </style>
</head>
<body>
    <div class="test-header"><h1>${jsonData.examTitle}</h1><div class="test-info"><div class="test-info-item"><div class="test-info-label">Questions</div><div class="test-info-value">${jsonData.examDetails.totalQuestions}</div></div><div class="test-info-item"><div class="test-info-label">Time</div><div class="test-info-value">${jsonData.examDetails.timeAllotted}</div></div><div class="test-info-item"><div class="test-info-label">Marks</div><div class="test-info-value">${jsonData.examDetails.maxMarks}</div></div></div></div>
    <div class="instructions"><h2>${jsonData.instructions.title}</h2><ul>${jsonData.instructions.points.map(p => `<li>${p}</li>`).join('')}</ul></div>
    ${jsonData.sections.map(s => `<div class="section-header"><h2 class="section-title">${s.sectionTitle}</h2></div>
        ${s.questionSets.map(qs => `${qs.type === 'group' && qs.directions ? `<div class="directions"><div class="directions-title">${qs.directions.title}</div><div>${qs.directions.text}</div></div>` : ''}
            ${qs.questions.map(q => `<div class="question"><span class="question-number">${q.questionNumber}.</span><div class="question-text">${q.questionText}</div>
                ${q.svg ? `<div class="svg-container">${q.svg}</div>` : ''}
                <div class="options">${q.options.map(o => `<div class="option"><strong>${o.label})</strong> ${o.text || ''}${o.svg ? `<div class="svg-container">${o.svg}</div>` : ''}</div>`).join('')}</div>
            </div>`).join('')}`).join('')}`).join('')}
    <div class="answer-solutions"><h2>Answer Key & Solutions</h2>
        ${jsonData.sections.map(s => s.questionSets.map(qs => qs.questions.map(q => `<div class="answer-item"><div class="answer-key">${q.questionNumber}: ${q.solution.answer}</div><div class="answer-explanation">${q.solution.explanation}</div>
            ${q.solution.svg ? `<div class="svg-container">${q.solution.svg}</div>` : ''}</div>`).join('')).join('')).join('')}
    </div></body></html>`;
    return html;
}

// --- JSON TO PPTX CONVERSION (using provided PPT script logic) ---
function convertHtmlToPptxRichText(html) {
    if (!html) return [{ text: '' }];
    const text = html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/?p>/gi, '');
    const parts = text.split(/(<\/?strong>)/g);
    const richText = [];
    let isBold = false;
    parts.forEach(p => {
        if (p === '<strong>') isBold = true;
        else if (p === '</strong>') isBold = false;
        else if (p) richText.push({ text: p, options: { bold: isBold } });
    });
    return richText.length > 0 ? richText : [{ text }];
}

function svgToBase64(svg) {
    if (!svg || !svg.includes('<svg')) return null;
    const match = svg.match(/<svg[^>]*>[\s\S]*?<\/svg>/i);
    return match ? `data:image/svg+xml;base64,${Buffer.from(match[0]).toString('base64')}` : null;
}

function addSlideWithBackground(pptx, bgPath) {
    const slide = pptx.addSlide();
    if (bgPath) slide.background = { path: bgPath };
    return slide;
}

function createTitleSlide(pptx, data, bg) {
    const slide = addSlideWithBackground(pptx, bg);
    slide.addText(data.examTitle, { x: 0.5, y: 1.5, w: '90%', h: 1, fontSize: 40, bold: true, color: '003B75', align: 'center' });
    const { totalQuestions, timeAllotted, maxMarks } = data.examDetails;
    slide.addText(`Total Questions: ${totalQuestions}  |  Time: ${timeAllotted}  |  Max Marks: ${maxMarks}`, { x: 0.5, y: 3.0, w: '90%', h: 0.5, fontSize: 20, color: '333333', align: 'center' });
}

function createInstructionsSlide(pptx, data, bg) {
    const slide = addSlideWithBackground(pptx, bg);
    slide.addText(data.instructions.title, { x: 0.5, y: 0.5, w: '90%', fontSize: 32, bold: true, color: '2B6CB0' });
    const points = data.instructions.points.map(p => ({ text: p, options: { fontSize: 18, bullet: true, paraSpcAfter: 10 } }));
    slide.addText(points, { x: 0.75, y: 1.5, w: '85%', h: 3.5 });
}

function createQuestionSlide(pptx, q, dirs, bg) {
    const slide = addSlideWithBackground(pptx, bg);
    slide.addText(`Question ${q.questionNumber}`, { x: 0.5, y: 0.4, w: '90%', fontSize: 24, bold: true, color: '1A365D' });
    let y = 1.0;
    if (dirs) {
        const cleanDirs = dirs.text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        slide.addText(`Directions: ${cleanDirs}`, { x: 0.5, y, w: '90%', h: 1.5, fontSize: 12, italic: true, color: '555555', fill: { color: 'E2E8F0' }, margin: 10 });
        y += 1.7;
    }
    const qHeight = q.questionText.length > 200 ? 1.5 : 1;
    slide.addText(convertHtmlToPptxRichText(q.questionText), { x: 0.5, y, w: '90%', h: qHeight, fontSize: 16 });
    y += qHeight + 0.2;
    if (q.svg) {
        const b64 = svgToBase64(q.svg);
        if (b64) {
            slide.addImage({ data: b64, x: 3, y, w: 4, h: 2 });
            y += 2.2;
        }
    }
    q.options.forEach(opt => {
        if (opt.svg) {
            slide.addText(`${opt.label})`, { x: 0.75, y, w: 0.5, h: 0.5, fontSize: 14 });
            const b64 = svgToBase64(opt.svg);
            if (b64) slide.addImage({ data: b64, x: 1.25, y: y - 0.25, w: 1, h: 1 });
            y += 1.2;
        } else {
            slide.addText(`${opt.label}) ${opt.text || ''}`, { x: 0.75, y, w: '85%', h: 0.3, fontSize: 14 });
            y += 0.4;
        }
    });
}

function createAnswerSlide(pptx, q, bg) {
    const slide = addSlideWithBackground(pptx, bg);
    slide.addText(`Answer & Solution: Q${q.questionNumber}`, { x: 0.5, y: 0.4, w: '90%', fontSize: 24, bold: true, color: '1A365D' });
    slide.addText(q.solution.answer, { x: 0.5, y: 1.0, w: '90%', h: 0.4, fontSize: 18, bold: true, color: '008000' });
    const cleanExp = q.solution.explanation.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    const hasSvg = q.solution.svg && svgToBase64(q.solution.svg);
    slide.addText(cleanExp, { x: 0.5, y: 1.6, w: hasSvg ? '50%' : '90%', h: 3.8, fontSize: 12 });
    if (hasSvg) slide.addImage({ data: svgToBase64(q.solution.svg), x: 5.5, y: 1.8, w: 4, h: 3 });
}

async function generatePptFromJson(jsonData, outputPath, backgroundPath) {
    try {
        console.log('📊 Creating PowerPoint presentation...');
        const pptx = new PptxGenJS();
        createTitleSlide(pptx, jsonData, backgroundPath);
        createInstructionsSlide(pptx, jsonData, backgroundPath);
        const allQs = jsonData.sections.flatMap(s => s.questionSets.flatMap(qs => qs.questions.map(q => ({ ...q, directions: qs.type === 'group' ? qs.directions : null }))));
        allQs.forEach(q => createQuestionSlide(pptx, q, q.directions, backgroundPath));
        const ansSlide = addSlideWithBackground(pptx, backgroundPath);
        ansSlide.addText('Answers & Solutions', { x: 0, y: '45%', w: '100%', align: 'center', fontSize: 44, color: '003B75', bold: true });
        allQs.forEach(q => createAnswerSlide(pptx, q, backgroundPath));
        await pptx.writeFile({ fileName: outputPath });
        console.log(`📊 PowerPoint generated successfully: ${path.basename(outputPath)}`);
    } catch (error) {
        VerboseLogger.logError('PowerPoint Generation', error, { outputPath });
        throw error;
    }
}

// --- PDF GENERATION FROM HTML ---
async function generatePdf(htmlContent, outputPath) {
    let browser = null;
    try {
        console.log('📄 Launching browser for PDF generation...');
        browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
        const page = await browser.newPage();
        await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
        await page.pdf({ path: outputPath, format: 'A4', margin: { top: '20mm', right: '15mm', bottom: '20mm', left: '15mm' }, printBackground: true });
        console.log(`📄 PDF generated successfully: ${path.basename(outputPath)}`);
    } catch (error) {
        VerboseLogger.logError('PDF Generation', error, { outputPath });
        throw error;
    } finally {
        if (browser) await browser.close();
    }
}

// --- API KEY MANAGER (unchanged) ---
class ApiKeyManager {
    constructor(apiKeys) {
        this.apiKeys = apiKeys.map(k => k.trim()).filter(Boolean);
        this.failedKeys = new Set();
        this.keyAssignments = new Map();
        console.log(`📋 Loaded ${this.apiKeys.length} API keys.`);
    }
    assignKeyToMock(mockNumber) {
        if (this.failedKeys.size === this.apiKeys.length) throw new Error("All API keys have failed.");
        let keyIndex = (mockNumber - 1) % this.apiKeys.length;
        while (this.failedKeys.has(keyIndex)) {
            keyIndex = (keyIndex + 1) % this.apiKeys.length;
        }
        this.keyAssignments.set(mockNumber, keyIndex);
        return { key: this.apiKeys[keyIndex], index: keyIndex };
    }
    getKeyForMock(mockNumber) {
        const keyIndex = this.keyAssignments.get(mockNumber);
        if (keyIndex === undefined || this.failedKeys.has(keyIndex)) {
            return this.assignKeyToMock(mockNumber);
        }
        return { key: this.apiKeys[keyIndex], index: keyIndex };
    }
    getNextAvailableKey(excludeIndex = -1) {
        for (let i = 0; i < this.apiKeys.length; i++) {
            if (!this.failedKeys.has(i) && i !== excludeIndex) {
                return { key: this.apiKeys[i], index: i };
            }
        }
        throw new Error("No alternative API keys available.");
    }
    markKeyAsFailed(keyIndex, error) {
        if (this.failedKeys.has(keyIndex)) return;
        this.failedKeys.add(keyIndex);
        VerboseLogger.logWarning('API Key Management', `API key ${keyIndex + 1} marked as failed.`, {
            Reason: error.message,
            RemainingKeys: this.apiKeys.length - this.failedKeys.size
        });
    }
}

let apiKeyManager = null;

// --- HELPER FUNCTIONS ---
function createGenerationConfig(options) {
    const config = {};
    if (options.maxTokens && options.maxTokens !== 8192) config.maxOutputTokens = options.maxTokens;
    if (options.temperature && options.temperature !== 0.7) config.temperature = options.temperature;
    return config;
}

async function findPdfFiles(dirPath) {
    const files = await fs.readdir(dirPath, { withFileTypes: true });
    let pdfs = [];
    for (const file of files) {
        const fullPath = path.join(dirPath, file.name);
        if (file.isDirectory()) {
            pdfs = pdfs.concat(await findPdfFiles(fullPath));
        } else if (path.extname(file.name).toLowerCase() === ".pdf") {
            pdfs.push(fullPath);
        }
    }
    return pdfs;
}

async function filesToGenerativeParts(filePaths, label) {
    const parts = [];
    for (const filePath of filePaths) {
        console.log(`- Processing ${label}: ${path.basename(filePath)}`);
        try {
            const fileBuffer = await fs.readFile(filePath);
            parts.push({ inlineData: { mimeType: 'application/pdf', data: fileBuffer.toString('base64') } });
        } catch (error) {
            VerboseLogger.logWarning('File Processing', `Could not read file ${path.basename(filePath)}. It will be skipped.`, { error: error.message });
        }
    }
    return parts;
}

function validateApiKey(apiKey) {
    const key = apiKey.trim();
    if (!key) {
        throw new Error("API key cannot be empty.");
    }
    return key;
}

async function validateDirectories(pyqDir, refMockDir) {
    try { await fs.access(pyqDir); } catch (e) { throw new Error(`PYQ directory '${pyqDir}' not accessible.`); }
    try { await fs.access(refMockDir); } catch (e) { throw new Error(`Reference mock directory '${refMockDir}' not accessible.`); }
}

function generateOutputFilename(base, num, total, ext) {
    const dir = path.dirname(base);
    const baseName = path.basename(base, path.extname(base));
    if (total === 1) return path.join(dir, baseName + ext);
    const padded = String(num).padStart(String(total).length, '0');
    return path.join(dir, `${baseName}_${padded}${ext}`);
}

// --- MAIN MOCK GENERATION FUNCTION (FIXED) ---
async function generateSingleMock(contents, outputPath, mockNumber, totalMocks, options) {
    const maxRetries = 3;
    let lastError = null;
    let currentKeyInfo = null;

    try {
        currentKeyInfo = apiKeyManager.assignKeyToMock(mockNumber);
        console.log(`\n🚀 Starting Mock ${mockNumber}/${totalMocks} with API Key ${currentKeyInfo.index + 1}...`);
    } catch (error) {
        VerboseLogger.logError('API Key Assignment', error, { mockNumber });
        return { success: false, error, outputPath };
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            currentKeyInfo = apiKeyManager.getKeyForMock(mockNumber);
            const genAI = new GoogleGenAI(currentKeyInfo.key);
            const model = genAI.getGenerativeModel({
                model: options.model,
                generationConfig: createGenerationConfig(options),
                systemInstruction: systemPrompt
            });

            if (options.rateLimitDelay > 0) {
                await new Promise(resolve => setTimeout(resolve, options.rateLimitDelay));
            }
            
            console.log(`🔄 Attempt ${attempt}/${maxRetries} for Mock ${mockNumber}...`);

            const result = await model.generateContent({ contents });
            const response = result.response;
            const generatedJson = response.text();
            
            if (!generatedJson || generatedJson.trim().length === 0) {
                throw new Error("API returned an empty text response.");
            }

            if (response.usageMetadata) {
                const { promptTokenCount, candidatesTokenCount, totalTokenCount } = response.usageMetadata;
                console.log(`📊 Token usage - Input: ${promptTokenCount}, Output: ${candidatesTokenCount}, Total: ${totalTokenCount}`);
            }

            let jsonData;
            try {
                let cleanJson = generatedJson.trim().replace(/^```json\s*/, '').replace(/\s*```$/, '');
                jsonData = JSON.parse(cleanJson);
            } catch (parseError) {
                throw new Error(`Failed to parse JSON response: ${parseError.message}`);
            }

            if (!jsonData.examTitle || !jsonData.examDetails || !jsonData.sections) {
                throw new Error("Invalid JSON structure - missing required fields.");
            }

            await fs.mkdir(path.dirname(outputPath), { recursive: true });

            if (options.saveJson) {
                const jsonPath = generateOutputFilename(options.output, mockNumber, totalMocks, '_debug.json');
                await fs.writeFile(jsonPath, JSON.stringify(jsonData, null, 2));
                console.log(`[DEBUG] Raw JSON saved: ${path.basename(jsonPath)}`);
            }
            
            const htmlContent = convertJsonToHtml(jsonData);
            
            if (options.saveHtml) {
                const htmlPath = generateOutputFilename(options.output, mockNumber, totalMocks, '_debug.html');
                await fs.writeFile(htmlPath, htmlContent);
                console.log(`[DEBUG] HTML saved: ${path.basename(htmlPath)}`);
            }

            await generatePdf(htmlContent, outputPath);

            if (options.ppt) {
                const pptPath = generateOutputFilename(options.output, mockNumber, totalMocks, '.pptx');
                await generatePptFromJson(jsonData, pptPath, options.pptBackground);
            }
            
            console.log(`✅ Mock ${mockNumber}/${totalMocks} completed successfully!`);
            return { success: true, outputPath };

        } catch (error) {
            lastError = error;
            VerboseLogger.logApiError(error, {
                mockNumber, attempt, keyIndex: currentKeyInfo?.index ?? 'N/A', model: options.model
            });
            
            const isQuotaError = error.message.includes('quota') || error.status === 429;
            if (isQuotaError && currentKeyInfo) {
                apiKeyManager.markKeyAsFailed(currentKeyInfo.index, error);
            }
            
            if (attempt < maxRetries) {
                 const waitTime = Math.pow(2, attempt) * 1000;
                 console.log(`⏳ Waiting ${waitTime / 1000}s before retry...`);
                 await new Promise(resolve => setTimeout(resolve, waitTime));
            }
        }
    }

    console.error(`❌ Mock ${mockNumber}/${totalMocks} FAILED after ${maxRetries} attempts.`);
    return { success: false, error: lastError, outputPath };
}


// --- MAIN EXECUTION LOGIC (FIXED) ---
async function main() {
    program
        .requiredOption("--pyq <dir>", "Directory containing previous year question PDFs")
        .requiredOption("--reference-mock <dir>", "Directory containing reference mock PDFs")
        .requiredOption("-o, --output <filename>", "Base output filename for generated files")
        .requiredOption("--prompt <file>", "Path to user prompt file")
        .option("--api-key-file <file>", "Path to API key file (default: api_key.txt)", "api_key.txt")
        .option("--number-of-mocks <number>", "Number of mocks to generate", "1")
        .option("--max-tokens <number>", "Maximum output tokens", (v) => parseInt(v, 10), 8192)
        .option("--temperature <number>", "Generation temperature", (v) => parseFloat(v), 0.7)
        .option("--concurrent-limit <number>", "Maximum concurrent requests", (v) => parseInt(v, 10), 3)
        .option("--rate-limit-delay <number>", "Delay between requests in ms", (v) => parseInt(v, 10), 1000)
        .option("--model <model>", "Gemini model to use", "gemini-1.5-flash-latest")
        .option("--ppt", "Generate a PowerPoint (.pptx) file")
        .option("--ppt-background <file>", "Background image for PowerPoint")
        .option("--save-json", "Save the raw generated JSON")
        .option("--save-html", "Save the generated HTML")
        .parse(process.argv);

    const options = program.opts();
    const numberOfMocks = parseInt(options.numberOfMocks, 10);
    const maxConcurrent = parseInt(options.concurrentLimit, 10);

    try {
        await validateDirectories(options.pyq, options.referenceMock);
        
        const apiKeyContent = await fs.readFile(options.apiKeyFile, "utf-8");
        // **FIX APPLIED HERE:** Filter out empty lines before validating keys.
        const apiKeys = apiKeyContent.split('\n').filter(Boolean).map(validateApiKey);
        
        if (apiKeys.length === 0) {
            throw new Error(`No valid API keys found in '${options.apiKeyFile}'. The file might be empty or contain only whitespace.`);
        }
        apiKeyManager = new ApiKeyManager(apiKeys);

        const userPrompt = await fs.readFile(options.prompt, "utf-8");
        
        console.log("\nProcessing input files...");
        const pyqParts = await filesToGenerativeParts(await findPdfFiles(options.pyq), "PYQ");
        const refMockParts = await filesToGenerativeParts(await findPdfFiles(options.referenceMock), "Reference Mock");

        if (pyqParts.length === 0 && refMockParts.length === 0) {
            throw new Error("No valid PDF files could be processed from the input directories.");
        }
        
        // This 'contents' array will be passed to the model, excluding the system prompt
        const contents = [
            ...pyqParts.map(p => ({ role: 'user', parts: [p, { text: 'This is a REFERENCE PYQ PDF.' }] })),
            ...refMockParts.map(p => ({ role: 'user', parts: [p, { text: 'This is a REFERENCE Mock Test PDF.' }] })),
            { role: 'user', parts: [{ text: `--- USER INSTRUCTIONS ---\n${userPrompt}` }] }
        ];

        console.log(`\n🚀 Starting generation of ${numberOfMocks} mock test(s)...`);
        const startTime = Date.now();
        
        const tasks = Array.from({ length: numberOfMocks }, (_, i) => {
            const num = i + 1;
            const outputPath = generateOutputFilename(options.output, num, numberOfMocks, '.pdf');
            return () => generateSingleMock(contents, outputPath, num, numberOfMocks, options);
        });

        const results = [];
        for (let i = 0; i < tasks.length; i += maxConcurrent) {
            const batch = tasks.slice(i, i + maxConcurrent).map(task => task());
            results.push(...await Promise.allSettled(batch));
        }
        
        const successful = results.filter(r => r.status === 'fulfilled' && r.value.success);
        const failed = results.filter(r => r.status === 'rejected' || !r.value?.success);

        console.log(`\n📈 Generation Summary:`);
        console.log(`✅ Successful: ${successful.length}/${numberOfMocks}`);
        console.log(`❌ Failed:     ${failed.length}/${numberOfMocks}`);
        console.log(`⏱️  Total time: ${(Date.now() - startTime) / 1000} seconds`);

        if (failed.length > 0) {
            console.error("\nSome mock generations failed. Please review the verbose error logs above.");
            process.exit(1);
        }

        console.log(`\n🎉 All mock tests generated successfully!`);

    } catch (error) {
        VerboseLogger.logError('Main Execution', error);
        process.exit(1);
    }
}

main();
