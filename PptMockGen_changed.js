import { GoogleGenAI } from "@google/genai";
import { program } from "commander";
import * as fs from "fs/promises";
import * as path from "path";
import puppeteer from "puppeteer";
import PptxGenJS from 'pptxgenjs';

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

5.  **Diagram Generation (SVG):**
   *   For any question, option, or solution requiring a diagram, you MUST provide a clear, well-labeled diagram.
   *   All diagrams must be drawn using **inline SVG** string elements embedded directly in the svg fields of the JSON.
   *   Escape SVG properly: replace < with \\u003c and > with \\u003e in JSON.
   *   Ensure SVG is valid and renders correctly.

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

// --- CHUNK-BASED SYSTEM PROMPT ---
const chunkSystemPrompt = `You are an expert exam designer and question creator specializing in competitive entrance exams. Your task is to generate EXACTLY the specified number of questions as part of a larger mock test.

IMPORTANT: You are generating a PARTIAL set of questions that will be merged with other chunks to form a complete mock test.

Follow these rules with absolute precision:

1.  **Analyze Reference Materials:**
   *   Carefully study all the provided "REFERENCE PYQ PDF" documents to understand question styles, common topics, difficulty level, and typical phrasing.
   *   Examine the "REFERENCE Mock Test PDF" documents to understand their structure and the tone of their instructions.

2.  **Generate Original Content:**
   *   You MUST NOT copy any questions or passages directly from the reference materials.
   *   All questions, options, and solutions you generate must be entirely new and unique.

3.  **Process User Instructions:**
   *   Generate EXACTLY the number of questions specified in the chunk request.
   *   Follow the user's requirements exactly regarding topics, difficulty, exam format, etc.
   *   Use the provided question number range for this chunk.

4.  **Format as a Single, Complete JSON Object:**
   *   The ENTIRE output MUST be a single JSON object. Do not wrap it in any formatting.
   *   This JSON represents a partial mock test that will be merged with other chunks.
   *   The JSON object must strictly adhere to the following schema:

   {
     "chunkInfo": {
       "chunkNumber": Number,
       "startQuestionNumber": Number,
       "endQuestionNumber": Number,
       "questionsInChunk": Number
     },
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

5.  **Content Rules:**
   *   Generate EXACTLY the requested number of questions, no more, no less.
   *   Use the provided question numbers for this chunk.
   *   Ensure every question has a corresponding solution with a clear answer and explanation.
   *   Keep explanations under 250 characters for streaming safety.
   *   Create realistic distractors that test conceptual understanding.

Generate the chunk following this format exactly.`;

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

// --- JSON TO PPTX CONVERSION ---
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
    slide.addText(`Question ${question.questionNumber}`, { 
        x: 0.5, y: 0.4, w: '90%', fontSize: 24, bold: true, color: '1A365D' 
    });
    
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
            slide.addText(`${opt.label})`, { 
                x: 0.75, y: currentY, w: 0.5, h: 0.5, fontSize: 14 
            });
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

// --- CHUNK MERGING FUNCTIONS ---
function mergeJsonChunks(chunks, totalQuestions) {
    if (chunks.length === 0) {
        throw new Error("No chunks to merge");
    }

    // Use the first chunk as the base structure
    const baseChunk = chunks[0];
    const mergedJson = {
        examTitle: baseChunk.examTitle,
        examDetails: {
            totalQuestions: totalQuestions,
            timeAllotted: baseChunk.examDetails.timeAllotted,
            maxMarks: baseChunk.examDetails.maxMarks
        },
        instructions: baseChunk.instructions,
        sections: []
    };

    // Collect all questions from all chunks
    const allQuestions = [];
    chunks.forEach((chunk, chunkIndex) => {
        console.log(`🔗 Processing chunk ${chunkIndex + 1} with ${chunk.chunkInfo?.questionsInChunk || 'unknown'} questions`);
        
        chunk.sections.forEach(section => {
            section.questionSets.forEach(questionSet => {
                questionSet.questions.forEach(question => {
                    allQuestions.push(question);
                });
            });
        });
    });

    // Sort questions by question number to ensure proper order
    allQuestions.sort((a, b) => {
        const numA = parseInt(a.questionNumber) || 0;
        const numB = parseInt(b.questionNumber) || 0;
        return numA - numB;
    });

    console.log(`🔗 Total questions collected: ${allQuestions.length}`);

    // Create a single section with all questions
    const mergedSection = {
        sectionTitle: baseChunk.sections[0]?.sectionTitle || "Mock Test Questions",
        questionSets: [{
            type: "single",
            directions: baseChunk.sections[0]?.questionSets[0]?.directions || null,
            questions: allQuestions
        }]
    };

    mergedJson.sections.push(mergedSection);

    return mergedJson;
}

// --- ENHANCED API KEY MANAGER ---
class ApiKeyManager {
    constructor(apiKeys) {
        this.apiKeys = apiKeys.map(key => key.trim()).filter(key => key.length > 0);
        this.keyUsageCount = new Map();
        this.failedKeys = new Set();
        this.keyLocks = new Map();
        this.currentKeyIndex = 0;
        
        this.apiKeys.forEach((key, index) => {
            this.keyUsageCount.set(index, 0);
            this.keyLocks.set(index, false);
        });
        
        console.log(`📋 Loaded ${this.apiKeys.length} API keys for chunked generation`);
    }

    getNextAvailableKey() {
        const availableKeys = this.apiKeys
            .map((key, index) => index)
            .filter(index => !this.failedKeys.has(index) && !this.keyLocks.get(index));

        if (availableKeys.length === 0) {
            throw new Error("No available API keys. All keys are either failed or locked.");
        }

        // Use round-robin selection among available keys
        const selectedIndex = availableKeys[this.currentKeyIndex % availableKeys.length];
        this.currentKeyIndex++;

        // Lock the key to prevent concurrent usage
        this.keyLocks.set(selectedIndex, true);

        return {
            key: this.apiKeys[selectedIndex],
            index: selectedIndex
        };
    }

    releaseKey(keyIndex) {
        this.keyLocks.set(keyIndex, false);
    }

    markKeyAsFailed(keyIndex, error) {
        this.failedKeys.add(keyIndex);
        this.keyLocks.set(keyIndex, false);
        console.log(`❌ API Key ${keyIndex + 1} marked as failed: ${error.message}`);
    }

    incrementUsage(keyIndex) {
        const currentUsage = this.keyUsageCount.get(keyIndex) || 0;
        this.keyUsageCount.set(keyIndex, currentUsage + 1);
    }

    getUsageStats() {
        const stats = {};
        this.apiKeys.forEach((key, index) => {
            const maskedKey = key.substring(0, 8) + '...';
            stats[maskedKey] = {
                usage: this.keyUsageCount.get(index) || 0,
                failed: this.failedKeys.has(index)
            };
        });
        return stats;
    }

    getAvailableKeyCount() {
        return this.apiKeys.length - this.failedKeys.size;
    }
}

let apiKeyManager = null;

// --- CHUNKED MOCK GENERATION FUNCTION ---
async function generateChunkedMock(contents, outputPath, mockNumber, totalMocks, options) {
    try {
        console.log(`🧩 Starting chunked generation for Mock ${mockNumber}/${totalMocks}`);

        const totalQuestions = extractTotalQuestions(options.userPrompt) || 50;
        const questionsPerChunk = 25;
        const totalChunks = Math.ceil(totalQuestions / questionsPerChunk);

        console.log(`📊 Generating ${totalQuestions} questions in ${totalChunks} chunks`);

        const chunkTasks = [];
        for (let chunkNum = 1; chunkNum <= totalChunks; chunkNum++) {
            const startQ = (chunkNum - 1) * questionsPerChunk + 1;
            const endQ = Math.min(chunkNum * questionsPerChunk, totalQuestions);
            const questionsInChunk = endQ - startQ + 1;

            chunkTasks.push({
                chunkNumber: chunkNum,
                startQuestionNumber: startQ,
                endQuestionNumber: endQ,
                questionsInChunk: questionsInChunk
            });
        }

        // Generate chunks with controlled concurrency
        const chunks = [];
        const failedChunks = [];

        for (const chunkTask of chunkTasks) {
            try {
                const result = await generateSingleChunk(contents, chunkTask, options);
                if (result.success) {
                    chunks.push(result.jsonData);
                    console.log(`✅ Chunk ${chunkTask.chunkNumber}/${totalChunks} completed (Questions ${chunkTask.startQuestionNumber}-${chunkTask.endQuestionNumber})`);
                } else {
                    failedChunks.push(chunkTask.chunkNumber);
                    console.error(`❌ Chunk ${chunkTask.chunkNumber}/${totalChunks} failed: ${result.error?.message}`);
                }
            } catch (error) {
                failedChunks.push(chunkTask.chunkNumber);
                console.error(`❌ Chunk ${chunkTask.chunkNumber}/${totalChunks} failed: ${error.message}`);
            }

            // Add delay between chunks to respect rate limits
            if (options.rateLimitDelay && options.rateLimitDelay > 0) {
                await new Promise(resolve => setTimeout(resolve, options.rateLimitDelay));
            }
        }

        if (chunks.length === 0) {
            throw new Error("All chunks failed to generate");
        }

        if (failedChunks.length > 0) {
            console.log(`⚠️  Warning: ${failedChunks.length} chunks failed, proceeding with ${chunks.length} successful chunks`);
        }

        // Merge chunks into complete mock test
        console.log(`🔗 Merging ${chunks.length} chunks into complete mock test...`);
        const mergedJsonData = mergeJsonChunks(chunks, totalQuestions);

        // Save debug JSON file if requested
        if (options.saveJson) {
            const debugJsonPath = generateDebugJsonFilename(options.output, mockNumber, totalMocks);
            try {
                await fs.writeFile(debugJsonPath, JSON.stringify(mergedJsonData, null, 2));
                console.log(`[DEBUG] Merged JSON for mock ${mockNumber} saved to: ${debugJsonPath}`);
            } catch(e) {
                console.error(`[DEBUG] Failed to save debug JSON file: ${e.message}`);
            }
        }

        // Convert to HTML and generate PDF
        console.log(`🔄 Converting merged JSON to HTML for mock ${mockNumber}...`);
        const htmlContent = convertJsonToHtml(mergedJsonData);

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

        // Ensure output directory exists
        const outputDir = path.dirname(outputPath);
        if (outputDir !== '.') {
            await fs.mkdir(outputDir, { recursive: true });
        }

        // Generate PDF
        console.log(`📄 Converting to PDF: ${path.basename(outputPath)}`);
        await generatePdf(htmlContent, outputPath);

        // Generate PPT if requested
        if (options.ppt) {
            const pptOutputPath = generateOutputFilename(options.output, mockNumber, totalMocks, '.pptx');
            const backgroundPath = options.pptBackground || null;
            await generatePptFromJson(mergedJsonData, pptOutputPath, backgroundPath);
        }

        console.log(`✅ Mock ${mockNumber}/${totalMocks} completed successfully: ${path.basename(outputPath)}`);

        return {
            success: true,
            outputPath: outputPath,
            totalQuestions: mergedJsonData.sections.reduce((total, section) =>
                total + section.questionSets.reduce((sectionTotal, qs) => sectionTotal + qs.questions.length, 0), 0
            ),
            chunksGenerated: chunks.length,
            chunksFailed: failedChunks.length,
            mockNumber: mockNumber,
            jsonData: mergedJsonData
        };

    } catch (error) {
        console.error(`❌ Chunked generation failed for Mock ${mockNumber}/${totalMocks}: ${error.message}`);
        return {
            success: false,
            error: error,
            outputPath: outputPath
        };
    }
}

// --- SINGLE CHUNK GENERATION FUNCTION ---
async function generateSingleChunk(contents, chunkTask, options) {
    const maxRetries = 3;
    let lastError = null;
    let currentKeyInfo = null;

    // Create chunk-specific prompt
    const chunkPrompt = `Generate EXACTLY ${chunkTask.questionsInChunk} questions for this chunk.
Question numbers should range from ${chunkTask.startQuestionNumber} to ${chunkTask.endQuestionNumber}.
This is chunk ${chunkTask.chunkNumber} of a larger mock test.

${options.userPrompt}`;

    const chunkContents = [
        { text: chunkSystemPrompt },
        ...contents.slice(1, -1), // Skip original system prompt and user prompt
        { text: "--- CHUNK GENERATION INSTRUCTIONS ---" },
        { text: chunkPrompt }
    ];

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            // Get next available key
            currentKeyInfo = apiKeyManager.getNextAvailableKey();
            const genAI = new GoogleGenAI({ apiKey: currentKeyInfo.key });

            console.log(`🔄 Chunk ${chunkTask.chunkNumber} - Attempt ${attempt}/${maxRetries} (API Key ${currentKeyInfo.index + 1})`);

            // Create generation config
            const generationConfig = createGenerationConfig(options, options.model);

            // Prepare request parameters
            const requestParams = {
                model: options.model,
                contents: chunkContents
            };

            // Add generation config if it has any settings
            if (Object.keys(generationConfig).length > 0) {
                requestParams.generationConfig = generationConfig;
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
                console.log(`📊 Chunk ${chunkTask.chunkNumber} Token usage (Key ${currentKeyInfo.index + 1}) - Input: ${usage.promptTokenCount || 'N/A'}, Output: ${usage.candidatesTokenCount || 'N/A'}, Thinking: ${usage.thoughtsTokenCount || 'N/A'}`);
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

            // Validate chunk JSON structure
            if (!jsonData.examTitle || !jsonData.examDetails || !jsonData.sections) {
                throw new Error("Invalid chunk JSON structure - missing required fields");
            }

            // Validate chunk info
            if (!jsonData.chunkInfo) {
                console.log(`⚠️  Warning: Chunk ${chunkTask.chunkNumber} missing chunkInfo, adding it`);
                jsonData.chunkInfo = {
                    chunkNumber: chunkTask.chunkNumber,
                    startQuestionNumber: chunkTask.startQuestionNumber,
                    endQuestionNumber: chunkTask.endQuestionNumber,
                    questionsInChunk: chunkTask.questionsInChunk
                };
            }

            // Update usage stats and release key
            apiKeyManager.incrementUsage(currentKeyInfo.index);
            apiKeyManager.releaseKey(currentKeyInfo.index);

            console.log(`✅ Chunk ${chunkTask.chunkNumber} completed with API Key ${currentKeyInfo.index + 1}`);

            return {
                success: true,
                jsonData: jsonData,
                contentLength: generatedJson.length,
                keyIndex: currentKeyInfo.index,
                usage: response.usageMetadata
            };

        } catch (error) {
            lastError = error;

            // Release key if it was acquired
            if (currentKeyInfo) {
                apiKeyManager.releaseKey(currentKeyInfo.index);
            }

            const isQuotaError = error.message.includes('quota') ||
                               error.message.includes('RESOURCE_EXHAUSTED') ||
                               error.message.includes('rate limit');

            if (isQuotaError && currentKeyInfo) {
                apiKeyManager.markKeyAsFailed(currentKeyInfo.index, error);
            }

            if (attempt === maxRetries) {
                console.error(`❌ Chunk ${chunkTask.chunkNumber} failed after ${maxRetries} attempts`);
                break;
            }

            // Wait before retrying
            const waitTime = Math.pow(1.5, attempt - 1) * 1000;
            console.log(`⏳ Chunk ${chunkTask.chunkNumber} - Waiting ${waitTime}ms before retry...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
    }

    return {
        success: false,
        error: lastError
    };
}

// --- UTILITY FUNCTIONS ---
function validateApiKey(apiKey) {
    if (!apiKey || typeof apiKey !== 'string') {
        throw new Error('API key must be a non-empty string');
    }

    const trimmedKey = apiKey.trim();
    if (trimmedKey.length === 0) {
        throw new Error('API key cannot be empty');
    }

    // Basic validation for Google AI API key format
    if (!trimmedKey.startsWith('AI') || trimmedKey.length < 20) {
        console.warn(`⚠️  Warning: API key "${trimmedKey.substring(0, 8)}..." may not be in the correct format`);
    }

    return trimmedKey;
}

function extractTotalQuestions(userPrompt) {
    // Try to extract total questions from user prompt
    const matches = userPrompt.match(/(\d+)\s*(?:questions?|ques|q)/i);
    return matches ? parseInt(matches[1]) : null;
}

function generateOutputFilename(baseName, mockNumber, totalMocks, extension) {
    const nameWithoutExt = path.parse(baseName).name;
    const dir = path.dirname(baseName);

    if (totalMocks === 1) {
        return path.join(dir, `${nameWithoutExt}${extension}`);
    } else {
        return path.join(dir, `${nameWithoutExt}_mock_${mockNumber}${extension}`);
    }
}

function generateDebugJsonFilename(baseName, mockNumber, totalMocks) {
    const nameWithoutExt = path.parse(baseName).name;
    const dir = path.dirname(baseName);

    if (totalMocks === 1) {
        return path.join(dir, `${nameWithoutExt}_debug.json`);
    } else {
        return path.join(dir, `${nameWithoutExt}_mock_${mockNumber}_debug.json`);
    }
}

function generateDebugHtmlFilename(baseName, mockNumber, totalMocks) {
    const nameWithoutExt = path.parse(baseName).name;
    const dir = path.dirname(baseName);

    if (totalMocks === 1) {
        return path.join(dir, `${nameWithoutExt}_debug.html`);
    } else {
        return path.join(dir, `${nameWithoutExt}_mock_${mockNumber}_debug.html`);
    }
}

function createGenerationConfig(options, model) {
    const config = {};

    if (options.maxTokens && options.maxTokens > 0) {
        config.maxOutputTokens = options.maxTokens;
    }

    if (options.temperature !== undefined && options.temperature >= 0 && options.temperature <= 2) {
        config.temperature = options.temperature;
    }

    // Add thinking budget if specified and supported by model
    if (options.thinkingBudget !== undefined) {
        const supportedModels = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro'];
        if (supportedModels.some(m => model.includes(m))) {
            if (options.thinkingBudget === -1) {
                // Dynamic thinking budget
                config.thoughtConfig = { enableThoughts: true };
            } else if (options.thinkingBudget > 0) {
                // Specific thinking budget
                config.thoughtConfig = {
                    enableThoughts: true,
                    maxThoughtsTokenCount: options.thinkingBudget
                };
            }
            // If thinkingBudget is 0, thinking is disabled (no config added)
        }
    }

    return config;
}

async function validateDirectories(...directories) {
    for (const dir of directories) {
        try {
            const stats = await fs.stat(dir);
            if (!stats.isDirectory()) {
                throw new Error(`${dir} is not a directory`);
            }
        } catch (error) {
            if (error.code === 'ENOENT') {
                throw new Error(`Directory does not exist: ${dir}`);
            }
            throw error;
        }
    }
}

async function findPdfFiles(directory) {
    try {
        const files = await fs.readdir(directory);
        const pdfFiles = files
            .filter(file => path.extname(file).toLowerCase() === '.pdf')
            .map(file => path.join(directory, file));
        return pdfFiles;
    } catch (error) {
        console.error(`Error reading directory ${directory}:`, error.message);
        return [];
    }
}

async function filesToGenerativeParts(filePaths, type) {
    const parts = [];

    for (const filePath of filePaths) {
        try {
            console.log(`📖 Processing ${type}: ${path.basename(filePath)}`);
            const fileBuffer = await fs.readFile(filePath);

            parts.push({
                inlineData: {
                    mimeType: "application/pdf",
                    data: fileBuffer.toString('base64')
                }
            });

            console.log(`✅ Successfully processed: ${path.basename(filePath)}`);
        } catch (error) {
            console.error(`❌ Failed to process ${path.basename(filePath)}: ${error.message}`);
        }
    }

    return parts;
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
        .option("--enable-chunking", "Enable chunked generation for large question sets (recommended for >25 questions)")
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

        // Store user prompt in options for chunk generation
        options.userPrompt = userPrompt;

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

        // 6. Determine if chunking should be used
        const totalQuestions = extractTotalQuestions(userPrompt) || 50;
        const useChunking = options.enableChunking || totalQuestions > 25;
        
        if (useChunking) {
            console.log(`🧩 Chunked generation enabled for ${totalQuestions} questions (25 questions per API call)`);
            const requiredAPIs = Math.ceil(totalQuestions / 25);
            console.log(`📋 Will require approximately ${requiredAPIs} API calls per mock test`);
            
            if (apiKeys.length < requiredAPIs) {
                console.warn(`⚠️  Warning: You have ${apiKeys.length} API keys but may need ${requiredAPIs} for optimal performance`);
            }
        } else {
            console.log(`📝 Standard generation mode for ${totalQuestions} questions`);
        }

        // 7. Generate mock tests
        console.log(`\n🚀 Starting generation of ${numberOfMocks} mock test(s)...`);
        let outputFormats = ["JSON", "PDF"];
        if (options.ppt) outputFormats.push("PowerPoint");
        console.log(`📄 Output Formats: ${outputFormats.join(', ')}`);
        if (options.saveJson) {
            console.log("💾 Debug JSON files will be saved.");
        }
        if (options.saveHtml) {
            console.log("💾 Debug HTML files will be saved.");
        }
        
        const startTime = Date.now();
        
        // Choose generation strategy based on chunking
        const generationTasks = [];
        for (let i = 1; i <= numberOfMocks; i++) {
            const outputPath = generateOutputFilename(options.output, i, numberOfMocks, '.pdf');
            
            if (useChunking) {
                generationTasks.push(() => generateChunkedMock(contents, outputPath, i, numberOfMocks, options));
            } else {
                generationTasks.push(() => generateSingleMock(contents, outputPath, i, numberOfMocks, options));
            }
        }

        // Execute tasks with concurrency limit
        const results = [];
        const concurrentLimit = useChunking ? 1 : maxConcurrent; // Limit concurrency for chunked generation
        
        for(let i = 0; i < generationTasks.length; i += concurrentLimit) {
            const batch = generationTasks.slice(i, i + concurrentLimit).map(task => task());
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
        
        if (useChunking && successful.length > 0) {
            const totalChunks = successful.reduce((sum, result) => sum + (result.chunksGenerated || 0), 0);
            const failedChunks = successful.reduce((sum, result) => sum + (result.chunksFailed || 0), 0);
            console.log(`🧩 Chunks processed: ${totalChunks} successful, ${failedChunks} failed`);
        }
        
        // Show API key usage statistics
        if (apiKeyManager) {
            const usage = apiKeyManager.getUsageStats();
            console.log(`\n📊 API Key Usage:`);
            Object.entries(usage).forEach(([key, stats]) => {
                const status = stats.failed ? '❌ FAILED' : '✅ Active';
                console.log(`  ${key}: ${stats.usage} requests ${status}`);
            });
        }
        
        if (successful.length > 0) {
            console.log(`\n📁 Generated Files:`);
            successful.sort((a,b) => (a.mockNumber || 0) - (b.mockNumber || 0)).forEach((mockResult, index) => {
                const mockNum = mockResult.mockNumber || index + 1;
                console.log(`  📄 ${path.basename(mockResult.outputPath)}`);
                
                if (useChunking) {
                    console.log(`      📊 ${mockResult.totalQuestions || 'N/A'} questions (${mockResult.chunksGenerated || 0} chunks)`);
                } else {
                    console.log(`      📊 ${mockResult.contentLength || 'N/A'} chars, API Key ${(mockResult.keyIndex || 0) + 1}`);
                }
                
                if (options.ppt) {
                    const pptOutputPath = generateOutputFilename(options.output, mockNum, numberOfMocks, '.pptx');
                    console.log(`  📊 ${path.basename(pptOutputPath)}`);
                }
                if (options.saveJson) {
                    const debugJsonPath = generateDebugJsonFilename(options.output, mockNum, numberOfMocks);
                    console.log(`  💾 ${path.basename(debugJsonPath)}`);
                }
                if (options.saveHtml) {
                    const debugHtmlPath = generateDebugHtmlFilename(options.output, mockNum, numberOfMocks);
                    console.log(`  💾 ${path.basename(debugHtmlPath)}`);
                }
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

        console.log(`\n🎉 Successfully generated ${successful.length} mock test(s)!`);
        
        if (useChunking) {
            console.log(`\n💡 Chunked generation used ${apiKeyManager.apiKeys.length} API keys to bypass output limits`);
        }

    } catch (error) {
        console.error("\n❌ An unexpected error occurred:");
        console.error(`- ${error.message}`);
        console.error("\nStack trace:");
        console.error(error.stack);
        process.exit(1);
    }
}

// --- ORIGINAL SINGLE MOCK GENERATION FUNCTION (for non-chunked mode) ---
async function generateSingleMock(contents, outputPath, mockNumber, totalMocks, options) {
    const maxRetries = 3;
    let lastError = null;
    let currentKeyInfo = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            // Get next available key
            currentKeyInfo = apiKeyManager.getNextAvailableKey();
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
