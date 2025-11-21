import { GoogleGenAI } from "@google/genai";
import { program } from "commander";
import * as fs from "fs/promises";
import * as path from "path";
import puppeteer from "puppeteer";
import PptxGenJS from 'pptxgenjs';
import { google } from 'googleapis';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// --- ENHANCED SYSTEM PROMPT FOR DETERMINISTIC JSON OUTPUT ---
const systemPrompt = `You are an expert exam designer and question creator specializing in competitive entrance exams. Your primary task is to generate a BRAND NEW, high-quality mock test and output it as a single, complete, and valid JSON object.

CRITICAL JSON FORMATTING RULES:
1. Your response MUST be ONLY a valid JSON object - no additional text, explanations, or markdown formatting
2. Do NOT wrap the JSON in markdown code blocks (no \`\`\`json or \`\`\`)
3. Ensure all string values are properly escaped:
   - Use \\" for quotes inside strings
   - Use \\\\ for backslashes
   - Use \\n for newlines (avoid actual line breaks in JSON strings)
   - Use \\t for tabs
   - Avoid control characters (\\u0000-\\u001F) completely
4. All text content should be clean, printable ASCII or properly encoded Unicode
5. Test mathematical expressions should use standard notation or HTML entities
6. Verify your JSON is parseable before outputting

Follow these content rules with absolute precision:

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

4.  **JSON Schema (MANDATORY):**
    The JSON object must strictly adhere to this schema:
    {
      "examTitle": "String",
      "examDetails": {
        "totalQuestions": Number,
        "timeAllotted": "String",
        "maxMarks": Number
      },
      "instructions": {
        "title": "String",
        "points": ["String", "String", ...]
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

5.  **Diagram Generation (SVG):**
    *   For any question, option, or solution requiring a diagram, provide a clear, well-labeled diagram.
    *   All diagrams must be complete, valid SVG strings.
    *   Ensure SVG content is properly escaped within JSON strings.

6.  **Content Quality:**
    *   Ensure every question has a corresponding solution with clear answer and explanation.
    *   Generate logical, solvable content free of contradictions.
    *   Use proper grammar, spelling, and formatting.

REMEMBER: Output ONLY the JSON object. No explanations, no markdown, no additional text.`;

// --- ENHANCED JSON VALIDATION AND CLEANING ---
function cleanJsonResponse(response) {
    try {
        let cleaned = response.trim();
        
        // Remove any markdown formatting
        if (cleaned.startsWith('```json')) {
            cleaned = cleaned.replace(/^```json\s*/, '').replace(/\s*```$/, '');
        } else if (cleaned.startsWith('```')) {
            cleaned = cleaned.replace(/^```\s*/, '').replace(/\s*```$/, '');
        }
        
        // Remove any leading/trailing non-JSON text
        const jsonStart = cleaned.indexOf('{');
        const jsonEnd = cleaned.lastIndexOf('}');
        
        if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
            cleaned = cleaned.substring(jsonStart, jsonEnd + 1);
        }
        
        // Fix common JSON issues
        cleaned = cleaned
            .replace(/[\u0000-\u001F\u007F-\u009F]/g, '') // Remove control characters
            .replace(/\\\\/g, '\\') // Fix double backslashes
            .replace(/\\n/g, '\\n') // Ensure proper newline escaping
            .replace(/\\t/g, '\\t') // Ensure proper tab escaping
            .replace(/\\"/g, '\\"'); // Ensure proper quote escaping
        
        // Validate by attempting to parse
        const parsed = JSON.parse(cleaned);
        
        // Re-stringify to ensure proper formatting
        return JSON.stringify(parsed, null, 2);
        
    } catch (error) {
        console.error('JSON cleaning failed:', error.message);
        throw new Error(`Failed to clean JSON response: ${error.message}`);
    }
}

function validateJsonStructure(jsonData) {
    const requiredFields = ['examTitle', 'examDetails', 'instructions', 'sections'];
    const missingFields = requiredFields.filter(field => !jsonData.hasOwnProperty(field));
    
    if (missingFields.length > 0) {
        throw new Error(`Missing required fields: ${missingFields.join(', ')}`);
    }
    
    if (!jsonData.examDetails.totalQuestions || !jsonData.examDetails.timeAllotted || !jsonData.examDetails.maxMarks) {
        throw new Error('Missing required examDetails fields');
    }
    
    if (!Array.isArray(jsonData.sections) || jsonData.sections.length === 0) {
        throw new Error('Sections must be a non-empty array');
    }
    
    // Validate each section has required structure
    jsonData.sections.forEach((section, index) => {
        if (!section.sectionTitle || !Array.isArray(section.questionSets)) {
            throw new Error(`Invalid structure in section ${index + 1}`);
        }
    });
    
    return true;
}

// --- GOOGLE SHEETS INTEGRATION ---
class GoogleSheetsUploader {
    constructor(credentialsPath) {
        this.credentialsPath = credentialsPath;
        this.auth = null;
        this.drive = null;
    }
    
    async initialize() {
        try {
            const credentials = JSON.parse(await fs.readFile(this.credentialsPath, 'utf8'));
            
            this.auth = new google.auth.GoogleAuth({
                credentials,
                scopes: [
                    'https://www.googleapis.com/auth/drive.file',
                    'https://www.googleapis.com/auth/spreadsheets'
                ]
            });
            
            this.drive = google.drive({ version: 'v3', auth: this.auth });
            console.log('✅ Google Drive API initialized successfully');
            
        } catch (error) {
            throw new Error(`Failed to initialize Google API: ${error.message}`);
        }
    }
    
    async uploadFile(filePath, fileName) {
        try {
            const fileMetadata = {
                name: fileName,
                parents: [] // Upload to root folder, modify as needed
            };
            
            const media = {
                mimeType: 'application/vnd.ms-powerpoint',
                body: await fs.createReadStream(filePath)
            };
            
            const response = await this.drive.files.create({
                resource: fileMetadata,
                media: media,
                fields: 'id,webViewLink,webContentLink'
            });
            
            // Make file publicly viewable (optional)
            await this.drive.permissions.create({
                fileId: response.data.id,
                resource: {
                    role: 'reader',
                    type: 'anyone'
                }
            });
            
            return {
                id: response.data.id,
                viewLink: response.data.webViewLink,
                downloadLink: response.data.webContentLink
            };
            
        } catch (error) {
            throw new Error(`Failed to upload to Google Drive: ${error.message}`);
        }
    }
}

// --- POWERPOINT TO PPT CONVERSION ---
async function convertPptxToPpt(pptxPath) {
    try {
        const outputDir = path.dirname(pptxPath);
        const command = `/Applications/LibreOffice.app/Contents/MacOS/soffice --headless --convert-to ppt --outdir "${outputDir}" "${pptxPath}"`;
        
        console.log('🔄 Converting PPTX to PPT format...');
        const { stdout, stderr } = await execAsync(command);
        
        if (stderr && !stderr.includes('Warning')) {
            console.warn('LibreOffice warnings:', stderr);
        }
        
        const pptPath = pptxPath.replace('.pptx', '.ppt');
        
        // Verify the PPT file was created
        try {
            await fs.access(pptPath);
            console.log('✅ Successfully converted to PPT format');
            return pptPath;
        } catch (error) {
            throw new Error('PPT file was not created');
        }
        
    } catch (error) {
        console.error('❌ PPT conversion failed:', error.message);
        console.log('💡 Make sure LibreOffice is installed at: /Applications/LibreOffice.app/');
        throw error;
    }
}

// --- JSON TO HTML CONVERSION (unchanged) ---
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

async function generatePptFromJson(jsonData, outputPath, backgroundPath, convertToPpt = false, uploadToGoogleDrive = false, googleSheetsUploader = null) {
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
        
        let finalPath = outputPath;
        let uploadResult = null;
        
        // Convert to PPT if requested
        if (convertToPpt) {
            try {
                finalPath = await convertPptxToPpt(outputPath);
            } catch (error) {
                console.warn('⚠️ PPT conversion failed, using PPTX format');
                finalPath = outputPath;
            }
        }
        
        // Upload to Google Drive if requested
        if (uploadToGoogleDrive && googleSheetsUploader) {
            try {
                const fileName = path.basename(finalPath);
                uploadResult = await googleSheetsUploader.uploadFile(finalPath, fileName);
                console.log('☁️ File uploaded to Google Drive successfully');
                console.log(`🔗 View Link: ${uploadResult.viewLink}`);
            } catch (error) {
                console.error('❌ Google Drive upload failed:', error.message);
            }
        }
        
        return {
            path: finalPath,
            uploadResult: uploadResult
        };
        
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
let googleSheetsUploader = null;

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
    
    if (options.maxTokens && options.maxTokens !== 8192) {
        config.maxOutputTokens = options.maxTokens;
    }
    
    if (options.temperature && options.temperature !== 2) {
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

// --- ENHANCED MOCK GENERATION FUNCTION ---
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
            
            // Enhanced generation config for deterministic JSON
            generationConfig.candidateCount = 1;
            if (!generationConfig.temperature) {
                generationConfig.temperature = 0.1; // Very low temperature for deterministic output
            }
            
            // Prepare request parameters
            const requestParams = {
                model: options.model,
                contents: contents
            };
            
            // Add generation config
            requestParams.generationConfig = generationConfig;
            
            // Add rate limiting delay
            if (options.rateLimitDelay && options.rateLimitDelay > 0) {
                const adjustedDelay = Math.max(100, options.rateLimitDelay / apiKeyManager.apiKeys.length);
                await new Promise(resolve => setTimeout(resolve, adjustedDelay));
            }
            
            const response = await genAI.models.generateContent(requestParams);
            
            if (!response || !response.text) {
                throw new Error("No response received from API");
            }
            
            let generatedJson = response.text;
            
            if (!generatedJson || generatedJson.trim().length === 0) {
                throw new Error("Empty response received from API");
            }

            // Log token usage if available
            if (response.usageMetadata) {
                const usage = response.usageMetadata;
                console.log(`📊 Token usage (Key ${currentKeyInfo.index + 1}) - Input: ${usage.promptTokenCount || 'N/A'}, Output: ${usage.candidatesTokenCount || 'N/A'}, Thinking: ${usage.thoughtsTokenCount || 'N/A'}`);
            }

            // Enhanced JSON cleaning and parsing
            let jsonData;
            try {
                const cleanedJson = cleanJsonResponse(generatedJson);
                jsonData = JSON.parse(cleanedJson);
                validateJsonStructure(jsonData);
                
            } catch (parseError) {
                console.error(`🔍 JSON Parse Error Details:`);
                console.error(`- Error: ${parseError.message}`);
                console.error(`- Response length: ${generatedJson.length} characters`);
                console.error(`- First 200 characters: ${generatedJson.substring(0, 200)}...`);
                console.error(`- Last 200 characters: ...${generatedJson.substring(generatedJson.length - 200)}`);
                
                throw new Error(`Failed to parse JSON response: ${parseError.message}`);
            }

            // Ensure output directory exists
            const outputDir = path.dirname(outputPath);
            if (outputDir !== '.') {
                await fs.mkdir(outputDir, { recursive: true });
            }

            // Always save debug JSON file for troubleshooting
            const debugJsonPath = generateDebugJsonFilename(options.output, mockNumber, totalMocks);
            try {
                await fs.writeFile(debugJsonPath, JSON.stringify(jsonData, null, 2));
                if (options.saveJson) {
                    console.log(`💾 Debug JSON for mock ${mockNumber} saved to: ${debugJsonPath}`);
                }
            } catch(e) {
                console.error(`[DEBUG] Failed to save debug JSON file: ${e.message}`);
            }

            const generatedFiles = [];
            let uploadResults = [];

            // Generate HTML if requested
            if (options.html) {
                console.log(`🔄 Converting JSON to HTML for mock ${mockNumber}...`);
                const htmlContent = convertJsonToHtml(jsonData);
                
                const htmlOutputPath = generateOutputFilename(options.output, mockNumber, totalMocks, '.html');
                await fs.writeFile(htmlOutputPath, htmlContent);
                generatedFiles.push(htmlOutputPath);
                console.log(`📄 HTML generated: ${path.basename(htmlOutputPath)}`);
                
                // Save debug HTML file if requested
                if (options.saveHtml) {
                    const debugHtmlPath = generateDebugHtmlFilename(options.output, mockNumber, totalMocks);
                    try {
                        await fs.writeFile(debugHtmlPath, htmlContent);
                        console.log(`💾 Debug HTML for mock ${mockNumber} saved to: ${debugHtmlPath}`);
                    } catch(e) {
                        console.error(`[DEBUG] Failed to save debug HTML file: ${e.message}`);
                    }
                }
            }

            // Generate PDF if requested
            if (options.pdf) {
                console.log(`🔄 Converting JSON to PDF for mock ${mockNumber}...`);
                const htmlContent = convertJsonToHtml(jsonData);
                
                console.log(`📄 Converting to PDF: ${path.basename(outputPath)}`);
                await generatePdf(htmlContent, outputPath);
                generatedFiles.push(outputPath);
            }

            // Generate PPT if requested
            if (options.ppt) {
                const pptxOutputPath = generateOutputFilename(options.output, mockNumber, totalMocks, '.pptx');
                const backgroundPath = options.pptBackground || null;
                
                const pptResult = await generatePptFromJson(
                    jsonData, 
                    pptxOutputPath, 
                    backgroundPath, 
                    options.convertToPpt, 
                    options.googleSheet, 
                    googleSheetsUploader
                );
                
                generatedFiles.push(pptResult.path);
                if (pptResult.uploadResult) {
                    uploadResults.push(pptResult.uploadResult);
                }
            }
            
            // Update usage stats
            apiKeyManager.incrementUsage(currentKeyInfo.index);
            
            console.log(`✅ Mock ${mockNumber}/${totalMocks} completed with API Key ${currentKeyInfo.index + 1}`);
            
            return {
                success: true,
                outputPath: outputPath,
                generatedFiles: generatedFiles,
                uploadResults: uploadResults,
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
async function main() {
    program
        .requiredOption("--pyq <dir>", "Directory containing previous year question PDFs")
        .requiredOption("--reference-mock <dir>", "Directory containing reference mock PDFs")
        .requiredOption("-o, --output <filename>", "Base output filename for generated files")
        .requiredOption("--prompt <file>", "Path to user prompt file containing specific instructions for the mock test")
        .option("--api-key-file <file>", "Optional: Path to API key file (default: api_key.txt)")
        .option("--number-of-mocks <number>", "Number of mock tests to generate (default: 1)", "1")
        .option("--max-tokens <number>", "Maximum output tokens per request (default: 8192)", parseInt, 8192)
        .option("--temperature <number>", "Temperature for response generation (0.0-2.0, default: 0.1)", parseFloat, 0.1)
        .option("--concurrent-limit <number>", "Maximum concurrent API requests (default: 3)", parseInt, 3)
        .option("--rate-limit-delay <number>", "Delay between API requests in ms (default: 1000)", parseInt, 1000)
        .option("--thinking-budget <number>", "Thinking budget tokens for internal reasoning. Use -1 for dynamic, 0 to disable, or specific number (Flash: 1-24576, Flash-Lite: 512-24576, Pro: 128-32768)")
        .option("--model <model>", "Gemini model to use (default: gemini-2.5-flash)", "gemini-2.5-flash")
        .option("--pdf", "Generate PDF files from the JSON data")
        .option("--html", "Generate HTML files from the JSON data")
        .option("--ppt", "Generate a PowerPoint (.pptx) file from the JSON data")
        .option("--convert-to-ppt", "Convert PPTX files to PPT format using LibreOffice")
        .option("--ppt-background <file>", "Background image file for PowerPoint slides")
        .option("--google-sheet", "Upload PPT files to Google Drive (requires credentials)")
        .option("--google-credentials <file>", "Path to Google service account credentials JSON file")
        .option("--save-json", "Save the raw generated JSON to a debug file")
        .option("--save-html", "Save the generated HTML to a debug file")
        .parse(process.argv);

    const options = program.opts();
    const apiKeyFile = options.apiKeyFile || "api_key.txt";
    const numberOfMocks = parseInt(options.numberOfMocks) || 1; 
    const maxConcurrent = options.concurrentLimit || 4;
    const rateDelay = options.rateLimitDelay || 1000;
    const thinkingBudget = options.thinkingBudget;
    const modelName = options.model || "gemini-2.5-pro";

    if (!numberOfMocks || isNaN(numberOfMocks) || numberOfMocks < 1) {
        console.error(`Error: --number-of-mocks must be a positive integer, got: ${numberOfMocks}`);
        process.exit(1);
    }

    // Validate output format selections
    if (!options.pdf && !options.html && !options.ppt) {
        console.error('Error: You must specify at least one output format: --pdf, --html, or --ppt');
        process.exit(1);
    }

    // Check for Puppeteer if PDF is requested
    if (options.pdf) {
        try {
            await import('puppeteer');
            console.log('✅ Puppeteer available - PDF generation is enabled.');
        } catch (error) {
            console.error('❌ Puppeteer is required for PDF generation but is not installed.');
            console.error('Please install it with: npm install puppeteer');
            process.exit(1);
        }
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

    // Initialize Google Sheets uploader if requested
    if (options.googleSheet) {
        if (!options.googleCredentials) {
            console.error('Error: --google-credentials is required when using --google-sheet');
            process.exit(1);
        }
        
        try {
            googleSheetsUploader = new GoogleSheetsUploader(options.googleCredentials);
            await googleSheetsUploader.initialize();
            console.log('✅ Google Drive integration initialized.');
        } catch (error) {
            console.error('❌ Google Drive initialization failed:', error.message);
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
        let outputFormats = [];
        if (options.pdf) outputFormats.push("PDF");
        if (options.html) outputFormats.push("HTML");
        if (options.ppt) {
            if (options.convertToPpt) {
                outputFormats.push("PowerPoint (PPT)");
            } else {
                outputFormats.push("PowerPoint (PPTX)");
            }
        }
        console.log(`📄 Output Formats: ${outputFormats.join(', ')}`);
        if (options.saveJson) {
            console.log("💾 Debug JSON files will be saved.");
        }
        if (options.saveHtml) {
            console.log("💾 Debug HTML files will be saved.");
        }
        if (options.googleSheet) {
            console.log("☁️ Files will be uploaded to Google Drive.");
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
                console.log(`  Mock ${mockResult.mockNumber}:`);
                
                mockResult.generatedFiles.forEach(filePath => {
                    console.log(`    📄 ${path.basename(filePath)}`);
                });
                
                if (options.saveJson) {
                    const debugJsonPath = generateDebugJsonFilename(options.output, mockResult.mockNumber, numberOfMocks);
                    console.log(`    💾 ${path.basename(debugJsonPath)}`);
                }
                
                if (options.saveHtml) {
                    const debugHtmlPath = generateDebugHtmlFilename(options.output, mockResult.mockNumber, numberOfMocks);
                    console.log(`    💾 ${path.basename(debugHtmlPath)}`);
                }
                
                // Display Google Drive upload results
                if (mockResult.uploadResults && mockResult.uploadResults.length > 0) {
                    mockResult.uploadResults.forEach(uploadResult => {
                        console.log(`    ☁️ Uploaded to Google Drive:`);
                        console.log(`       🔗 View: ${uploadResult.viewLink}`);
                        console.log(`       📥 Download: ${uploadResult.downloadLink}`);
                    });
                }
                
                console.log(`    📊 ${mockResult.contentLength} chars, API Key ${mockResult.keyIndex + 1}`);
            });
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

        // Summary of all generated URLs if Google Drive upload was used
        if (options.googleSheet && successful.some(r => r.uploadResults?.length > 0)) {
            console.log(`\n☁️ Google Drive Upload Summary:`);
            successful.forEach(mockResult => {
                if (mockResult.uploadResults && mockResult.uploadResults.length > 0) {
                    mockResult.uploadResults.forEach(uploadResult => {
                        console.log(`📎 Mock ${mockResult.mockNumber}: ${uploadResult.viewLink}`);
                    });
                }
            });
        }

        console.log(`\n🎉 Successfully generated ${successful.length} mock test(s)!`);
        
        // Display format breakdown
        const formatCounts = {
            json: successful.length, // Always generated internally
            html: options.html ? successful.length : 0,
            pdf: options.pdf ? successful.length : 0,
            pptx: options.ppt ? successful.length : 0,
            ppt: (options.ppt && options.convertToPpt) ? successful.length : 0
        };
        
        console.log(`📊 Format breakdown:`);
        if (formatCounts.html > 0) console.log(`   📄 HTML: ${formatCounts.html} files`);
        if (formatCounts.pdf > 0) console.log(`   📄 PDF: ${formatCounts.pdf} files`);
        if (formatCounts.pptx > 0) console.log(`   📊 PPTX: ${formatCounts.pptx} files`);
        if (formatCounts.ppt > 0) console.log(`   📊 PPT: ${formatCounts.ppt} files`);
        if (options.saveJson) console.log(`   💾 Debug JSON: ${formatCounts.json} files`);
        if (options.saveHtml) console.log(`   💾 Debug HTML: ${formatCounts.json} files`);

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
