import { GoogleGenAI } from "@google/genai";
import { program } from "commander";
import * as fs from "fs/promises";
import * as path from "path";
import puppeteer from "puppeteer";
import PptxGenJS from 'pptxgenjs';

// --- UPDATED SYSTEM PROMPT FOR SIMPLIFIED JSON OUTPUT ---
const systemPrompt = `You are an expert exam designer and question creator for competitive entrance exams. Generate a BRAND NEW mock test and output it as a single, valid JSON object.

CRITICAL RULES:
1. Output ONLY valid JSON - no markdown, no extra text
2. Prefer FLAT structure but allow light nesting when needed (sections, instructions)
3. Keep strings short (under 200 characters each)
4. Avoid special characters that break JSON
5. Each question must have answer and explanation

JSON SCHEMA:
{
  "examTitle": "String",
  "examDetails": {
    "totalQuestions": Number,
    "timeAllotted": "String",
    "maxMarks": Number
  },
  "instructions": {
    "title": "String",
    "points": ["String","String"]
  },
  "sections": [
    {
      "sectionTitle": "String",
      "questions": [
        {
          "num": "1",
          "type": "single | group",
          "directions": "String or null",
          "text": "Question text",
          "diagram": "svg_string_or_null",
          "a": "Option A",
          "b": "Option B",
          "c": "Option C",
          "d": "Option D",
          "ans": "a|b|c|d",
          "exp": "Brief explanation",
          "exp_diagram": "svg_string_or_null"
        }
      ]
    }
  ]
}

SVG RULES:
- Use ONLY if essential for solving
- Keep under 500 characters
- Must be valid inline SVG
- Escape < and > properly with unicode (\\u003c and \\u003e)

CONTENT RULES:
- Questions must be original
- Match style and difficulty of reference exams
- Each solution clear and short
- Diagrams minimal, essential only
- Strings simple and safe (no special chars, no newlines)
- Explanations under 150 characters

GENERATION APPROACH:
- Follow schema strictly
- One complete question at a time
- Ensure valid JSON
- Ensure unique question numbers
- Test each SVG string is valid and escaped`;

// --- JSON TO HTML CONVERSION WITH SIMPLIFIED SCHEMA ---
function convertJsonToHtml(jsonData, fontOptions = {}) {
    const { fontName = 'Arial', fontSize = 11 } = fontOptions;
    
    // Calculate relative font sizes based on the base font size
    const baseFontSize = fontSize;
    const headerFontSize = baseFontSize * 2.0;
    const subHeaderFontSize = baseFontSize * 1.57;
    const sectionTitleFontSize = baseFontSize * 1.29;
    const questionNumberFontSize = baseFontSize * 1.14;
    const answerKeyFontSize = baseFontSize * 1.07;
    const optionFontSize = baseFontSize * 0.93;
    const instructionFontSize = baseFontSize;
    
    // Decode SVG strings (convert unicode back to < and >)
    const decodeSvg = (svgString) => {
        if (!svgString) return null;
        return svgString.replace(/\\u003c/g, '<').replace(/\\u003e/g, '>');
    };
    
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
            font-size: ${headerFontSize}pt;
            font-weight: 700;
            margin-bottom: 8px;
            border: none;
        }
        
        .test-info {
            display: flex;
            justify-content: space-around;
            margin-top: 16px;
            font-size: ${baseFontSize}pt;
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
            font-size: ${baseFontSize * 1.14}pt;
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
            font-size: ${subHeaderFontSize}pt;
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
            font-size: ${sectionTitleFontSize}pt;
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
            font-size: ${questionNumberFontSize}pt;
        }
        
        .question-text {
            margin: 8px 0 12px 0;
            font-size: ${baseFontSize}pt;
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
                font-size: ${baseFontSize * 0.86}pt;
                line-height: 1.4;
                padding: 10px;
            }
            
            .test-header h1 {
                font-size: ${headerFontSize * 0.86}pt;
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
                font-size: ${baseFontSize * 0.93}pt;
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
        
        ${section.questions.map(question => `
            <div class="question">
                ${question.directions ? `
                    <div class="directions">
                        <div class="directions-title">Directions:</div>
                        <div>${question.directions}</div>
                    </div>
                ` : ''}
                
                <span class="question-number">${question.num}.</span>
                <div class="question-text">${question.text}</div>
                
                ${question.diagram ? `
                    <div class="svg-container">
                        ${decodeSvg(question.diagram)}
                    </div>
                ` : ''}
                
                <div class="options">
                    <div class="option"><strong>A)</strong> ${question.a}</div>
                    <div class="option"><strong>B)</strong> ${question.b}</div>
                    <div class="option"><strong>C)</strong> ${question.c}</div>
                    <div class="option"><strong>D)</strong> ${question.d}</div>
                </div>
            </div>
        `).join('')}
    `).join('')}

    <div class="answer-solutions">
        <h2>Answer Key & Solutions</h2>
        ${jsonData.sections.map(section => 
            section.questions.map(question => `
                <div class="answer-item">
                    <div class="answer-key">${question.num}: ${question.ans.toUpperCase()}</div>
                    <div class="answer-explanation">${question.exp}</div>
                    ${question.exp_diagram ? `
                        <div class="svg-container">
                            ${decodeSvg(question.exp_diagram)}
                        </div>
                    ` : ''}
                </div>
            `).join('')
        ).join('')}
    </div>
</body>
</html>`;

    return html;
}

// --- ENHANCED ERROR ANALYSIS FUNCTIONS ---
function analyzeApiError(error, requestDetails = {}) {
    const errorInfo = {
        type: 'unknown',
        category: 'general',
        isRetriable: false,
        suggestedAction: 'Check error details and try again',
        details: {},
        originalMessage: error.message || 'Unknown error'
    };

    const errorMessage = error.message?.toLowerCase() || '';
    const errorCode = error.code || error.status || 'unknown';
    
    // Analyze error patterns
    if (errorMessage.includes('quota') || errorMessage.includes('resource_exhausted') || 
        errorMessage.includes('rate limit') || errorCode === 429) {
        errorInfo.type = 'quota_exceeded';
        errorInfo.category = 'quota';
        errorInfo.isRetriable = false; // Don't retry with same key
        errorInfo.suggestedAction = 'Switch to different API key or wait for quota reset';
        errorInfo.details = {
            quotaType: errorMessage.includes('daily') ? 'daily' : 
                      errorMessage.includes('minute') ? 'per-minute' : 
                      errorMessage.includes('hour') ? 'hourly' : 'general',
            resetTime: extractResetTime(errorMessage)
        };
    } else if (errorMessage.includes('invalid') && errorMessage.includes('key')) {
        errorInfo.type = 'invalid_api_key';
        errorInfo.category = 'authentication';
        errorInfo.isRetriable = false;
        errorInfo.suggestedAction = 'Verify API key is correct and has necessary permissions';
    } else if (errorMessage.includes('permission') || errorMessage.includes('forbidden') || 
               errorCode === 403) {
        errorInfo.type = 'permission_denied';
        errorInfo.category = 'authorization';
        errorInfo.isRetriable = false;
        errorInfo.suggestedAction = 'Check API key permissions and model access';
    } else if (errorMessage.includes('timeout') || errorMessage.includes('timed out')) {
        errorInfo.type = 'timeout';
        errorInfo.category = 'network';
        errorInfo.isRetriable = true;
        errorInfo.suggestedAction = 'Retry with exponential backoff';
    } else if (errorMessage.includes('network') || errorMessage.includes('connection') ||
               errorMessage.includes('econnreset') || errorMessage.includes('enotfound')) {
        errorInfo.type = 'network_error';
        errorInfo.category = 'network';
        errorInfo.isRetriable = true;
        errorInfo.suggestedAction = 'Check internet connection and retry';
    } else if (errorMessage.includes('model') && errorMessage.includes('not found')) {
        errorInfo.type = 'model_not_found';
        errorInfo.category = 'configuration';
        errorInfo.isRetriable = false;
        errorInfo.suggestedAction = 'Verify model name is correct and available';
    } else if (errorMessage.includes('content') && errorMessage.includes('too large')) {
        errorInfo.type = 'content_too_large';
        errorInfo.category = 'content';
        errorInfo.isRetriable = false;
        errorInfo.suggestedAction = 'Reduce input size or split into smaller requests';
    } else if (errorMessage.includes('safety') || errorMessage.includes('policy')) {
        errorInfo.type = 'safety_filter';
        errorInfo.category = 'content';
        errorInfo.isRetriable = false;
        errorInfo.suggestedAction = 'Modify content to comply with safety policies';
    } else if (errorCode >= 500) {
        errorInfo.type = 'server_error';
        errorInfo.category = 'server';
        errorInfo.isRetriable = true;
        errorInfo.suggestedAction = 'Retry after brief delay - server-side issue';
    } else if (errorCode >= 400 && errorCode < 500) {
        errorInfo.type = 'client_error';
        errorInfo.category = 'request';
        errorInfo.isRetriable = false;
        errorInfo.suggestedAction = 'Check request parameters and format';
    }

    // Add request context
    errorInfo.context = {
        model: requestDetails.model || 'unknown',
        attempt: requestDetails.attempt || 1,
        maxRetries: requestDetails.maxRetries || 3,
        keyIndex: requestDetails.keyIndex,
        mockNumber: requestDetails.mockNumber,
        timestamp: new Date().toISOString(),
        requestSize: requestDetails.contentSize || 'unknown'
    };

    return errorInfo;
}

function extractResetTime(errorMessage) {
    // Try to extract reset time from error message
    const resetPatterns = [
        /reset.*?(\d+)\s*(hour|minute|second)/i,
        /try.*?(\d+)\s*(hour|minute|second)/i,
        /wait.*?(\d+)\s*(hour|minute|second)/i
    ];
    
    for (const pattern of resetPatterns) {
        const match = errorMessage.match(pattern);
        if (match) {
            return `${match[1]} ${match[2]}(s)`;
        }
    }
    return null;
}

function formatDetailedError(errorInfo, mockNumber) {
    const lines = [];
    lines.push(`❌ DETAILED ERROR REPORT - Mock ${mockNumber}`);
    lines.push(`┌${'─'.repeat(60)}`);
    lines.push(`│ Error Type: ${errorInfo.type.toUpperCase()}`);
    lines.push(`│ Category: ${errorInfo.category}`);
    lines.push(`│ Retriable: ${errorInfo.isRetriable ? 'Yes' : 'No'}`);
    lines.push(`│ Timestamp: ${errorInfo.context.timestamp}`);
    
    if (errorInfo.context.keyIndex !== undefined) {
        lines.push(`│ API Key: #${errorInfo.context.keyIndex + 1}`);
    }
    
    if (errorInfo.context.model) {
        lines.push(`│ Model: ${errorInfo.context.model}`);
    }
    
    if (errorInfo.context.attempt) {
        lines.push(`│ Attempt: ${errorInfo.context.attempt}/${errorInfo.context.maxRetries}`);
    }
    
    lines.push(`├${'─'.repeat(60)}`);
    lines.push(`│ Original Message:`);
    lines.push(`│ ${errorInfo.originalMessage}`);
    
    if (Object.keys(errorInfo.details).length > 0) {
        lines.push(`├${'─'.repeat(60)}`);
        lines.push(`│ Additional Details:`);
        Object.entries(errorInfo.details).forEach(([key, value]) => {
            if (value) {
                lines.push(`│ ${key}: ${value}`);
            }
        });
    }
    
    lines.push(`├${'─'.repeat(60)}`);
    lines.push(`│ Suggested Action:`);
    lines.push(`│ ${errorInfo.suggestedAction}`);
    lines.push(`└${'─'.repeat(60)}`);
    
    return lines.join('\n');
}

// --- ENHANCED ERROR LOGGING ---
function logApiErrorStats(errorInfo, apiKeyManager) {
    console.log(`\n📊 API ERROR STATISTICS:`);
    console.log(`┌${'─'.repeat(50)}`);
    console.log(`│ Total API Keys: ${apiKeyManager.apiKeys.length}`);
    console.log(`│ Failed Keys: ${apiKeyManager.failedKeys.size}`);
    console.log(`│ Active Keys: ${apiKeyManager.apiKeys.length - apiKeyManager.failedKeys.size}`);
    
    if (apiKeyManager.failedKeys.size > 0) {
        console.log(`│ Failed Key IDs: [${Array.from(apiKeyManager.failedKeys).map(i => i + 1).join(', ')}]`);
    }
    
    console.log(`├${'─'.repeat(50)}`);
    console.log(`│ Key Usage Count:`);
    apiKeyManager.keyUsageCount.forEach((count, keyIndex) => {
        const status = apiKeyManager.failedKeys.has(keyIndex) ? ' (FAILED)' : ' (Active)';
        console.log(`│ Key ${keyIndex + 1}: ${count} requests${status}`);
    });
    console.log(`└${'─'.repeat(50)}`);
}

// --- SIMPLIFIED JSON TO PPTX CONVERSION ---
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

async function svgToPngBase64(svgContent) {
    if (!svgContent || !svgContent.includes('<svg')) return null;

    let browser = null;
    try {
        browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();
        
        await page.evaluate(() => {
            document.body.style.background = 'transparent';
        });

        // Decode SVG if it has unicode escaping
        const decodedSvg = svgContent.replace(/\\u003c/g, '<').replace(/\\u003e/g, '>');

        await page.setContent(`<!DOCTYPE html>
<html>
<head>
<style>
  body, html { margin: 0; padding: 0; background: transparent; }
  svg { display: inline-block; }
</style>
</head>
<body>${decodedSvg}</body>
</html>`, { waitUntil: 'networkidle0' });

        const svgElement = await page.$('svg');
        if (!svgElement) {
            throw new Error('SVG element not found on page');
        }

        const buffer = await svgElement.screenshot({
            encoding: 'base64',
            omitBackground: true
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
    
    slide.addText(data.examTitle, {
        x: 0.5, y: 1.5, w: '90%', h: 1, 
        fontSize: fontSize,
        bold: true, color: '003B75', align: 'center',
        fontFace: fontName
    });
    
    const details = data.examDetails;
    const detailsText = `Total Questions: ${details.totalQuestions}  |  Time Allotted: ${details.timeAllotted}  |  Max Marks: ${details.maxMarks}`;
    slide.addText(detailsText, {
        x: 0.5, y: 3.0, w: '90%', h: 0.5, 
        fontSize: Math.round(fontSize),
        color: '333333', align: 'center',
        fontFace: fontName
    });
}

function createInstructionsSlide(pptx, data, bgImagePath, fontOptions = {}) {
    const { fontName = 'Arial', fontSize = 11 } = fontOptions;
    const slide = addSlideWithBackground(pptx, bgImagePath);
    
    slide.addText(data.instructions.title, { 
        x: 0.5, y: 0.5, w: '90%', 
        fontSize: Math.round(fontSize),
        bold: true, color: '2B6CB0',
        fontFace: fontName
    });
    
    const instructionPoints = data.instructions.points.map(point => ({ 
        text: point, 
        options: { 
            fontSize: Math.round(fontSize),
            bullet: true, 
            paraSpcAfter: 10,
            fontFace: fontName
        } 
    }));
    
    slide.addText(instructionPoints, {
        x: 0.75, y: 1.5, w: '85%', h: 3.5,
    });
}

async function createQuestionSlide(pptx, question, bgImagePath, fontOptions = {}) {
    const { fontName = 'Arial', fontSize = 11 } = fontOptions;
    const slide = addSlideWithBackground(pptx, bgImagePath);
    
    slide.addText(`Question ${question.num}`, { 
        x: 0.5, y: 0.4, w: '90%', 
        fontSize: Math.round(fontSize),
        bold: true, color: '1A365D',
        fontFace: fontName
    });

    let currentY = 1.0;
    
    if (question.directions) {
        slide.addText(`Directions: ${question.directions}`, {
            x: 0.5, y: currentY, w: '90%', h: 1.5,
            fontSize: Math.round(fontSize),
            italic: true, color: '555555', fill: { color: 'E2E8F0' }, margin: 10,
            fontFace: fontName
        });
        currentY += 1.7;
    }
    
    const questionTextHeight = question.text.length > 200 ? 1.5 : 1;
    slide.addText(question.text, {
        x: 0.5, y: currentY, w: '90%', h: questionTextHeight, 
        fontSize: Math.round(fontSize),
        fontFace: fontName
    });
    currentY += questionTextHeight + 0.2;

    if (question.diagram) {
        const pngBase64 = await svgToPngBase64(question.diagram);
        if (pngBase64) {
            slide.addImage({ data: pngBase64, x: 3, y: currentY, w: 4, h: 2 });
            currentY += 2.2;
        }
    }
    
    // Add options
    const options = [
        { label: 'A', text: question.a },
        { label: 'B', text: question.b },
        { label: 'C', text: question.c },
        { label: 'D', text: question.d }
    ];
    
    for (const opt of options) {
        const optionText = `${opt.label}) ${opt.text}`;
        slide.addText(optionText, { 
            x: 0.75, y: currentY, w: '85%', h: 0.3, 
            fontSize: fontSize,
            fontFace: fontName
        });
        currentY += 0.4;
    }
}

async function createAnswerSlide(pptx, question, bgImagePath, fontOptions = {}) {
    const { fontName = 'Arial', fontSize = 11 } = fontOptions;
    const slide = addSlideWithBackground(pptx, bgImagePath);
    
    slide.addText(`Answer & Solution: Q${question.num}`, { 
        x: 0.5, y: 0.4, w: '90%', 
        fontSize: Math.round(fontSize),
        bold: true, color: '1A365D',
        fontFace: fontName
    });

    slide.addText(`Answer: ${question.ans.toUpperCase()}`, {
        x: 0.5, y: 1.0, w: '90%', h: 0.4,
        fontSize: Math.round(fontSize * 1.29),
        bold: true, color: '008000',
        fontFace: fontName
    });
    
    const pngBase64 = await svgToPngBase64(question.exp_diagram);
    
    slide.addText(question.exp, {
        x: 0.5, y: 1.6, w: pngBase64 ? '50%' : '90%', h: 3.8, 
        fontSize: Math.round(fontSize),
        fontFace: fontName
    });
    
    if (pngBase64) {
        slide.addImage({ data: pngBase64, x: 5.5, y: 1.8, w: 4, h: 3, });
    }
}

async function generatePptFromJson(jsonData, outputPath, backgroundPath, fontOptions = {}) {
    try {
        console.log('📊 Creating PowerPoint presentation...');
        
        const pptx = new PptxGenJS();
        
        createTitleSlide(pptx, jsonData, backgroundPath, fontOptions);
        createInstructionsSlide(pptx, jsonData, backgroundPath, fontOptions);

        const allQuestions = [];
        jsonData.sections.forEach(section => {
            section.questions.forEach(q => allQuestions.push(q));
        });

        console.log('📝 Creating question slides...');
        for (const q of allQuestions) {
            await createQuestionSlide(pptx, q, backgroundPath, fontOptions);
        }

        const answerTitleSlide = addSlideWithBackground(pptx, backgroundPath);
        answerTitleSlide.addText('Answers & Solutions', { 
            x: 0, y: '45%', w: '100%', align: 'center', 
            fontSize: Math.round((fontOptions.fontSize || 11)),
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

// --- PDF GENERATION FROM HTML WITH FONT OPTIONS ---
async function generatePdf(htmlContent, outputPath, fontOptions = {}) {
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

// --- API KEY MANAGER (enhanced with error tracking) ---
class ApiKeyManager {
    constructor(apiKeys) {
        this.apiKeys = apiKeys.map(key => key.trim()).filter(key => key.length > 0);
        this.keyUsageCount = new Map();
        this.failedKeys = new Set();
        this.keyAssignments = new Map();
        this.keyLocks = new Map();
        this.keyErrorHistory = new Map(); // Track error history per key
        
        this.apiKeys.forEach((key, index) => {
            this.keyUsageCount.set(index, 0);
            this.keyLocks.set(index, false);
            this.keyErrorHistory.set(index, []);
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

    markKeyAsFailed(keyIndex, error, errorInfo = null) {
        this.failedKeys.add(keyIndex);
        
        // Track error in history
        const errorRecord = {
            timestamp: new Date().toISOString(),
            message: error.message,
            type: errorInfo?.type || 'unknown',
            category: errorInfo?.category || 'general'
        };
        
        const history = this.keyErrorHistory.get(keyIndex) || [];
        history.push(errorRecord);
        this.keyErrorHistory.set(keyIndex, history);
        
        // Enhanced failure logging
        console.log(`\n🚨 API KEY FAILURE DETAILS:`);
        console.log(`┌${'─'.repeat(50)}`);
        console.log(`│ Key ID: ${keyIndex + 1}`);
        console.log(`│ Previous Requests: ${this.keyUsageCount.get(keyIndex) || 0}`);
        console.log(`│ Error Type: ${errorInfo?.type || 'unknown'}`);
        console.log(`│ Error Category: ${errorInfo?.category || 'general'}`);
        console.log(`│ Failure Time: ${errorRecord.timestamp}`);
        console.log(`├${'─'.repeat(50)}`);
        console.log(`│ Error Message:`);
        console.log(`│ ${error.message}`);
        console.log(`└${'─'.repeat(50)}`);
        
        if (this.failedKeys.size < this.apiKeys.length) {
            console.log(`🔄 ${this.apiKeys.length - this.failedKeys.size} API keys remaining`);
        } else {
            console.log(`🚨 ALL API KEYS HAVE FAILED!`);
        }
        
        // Remove failed key assignments
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

    getKeyErrorHistory(keyIndex) {
        return this.keyErrorHistory.get(keyIndex) || [];
    }

    getOverallStats() {
        return {
            totalKeys: this.apiKeys.length,
            activeKeys: this.apiKeys.length - this.failedKeys.size,
            failedKeys: this.failedKeys.size,
            totalRequests: Array.from(this.keyUsageCount.values()).reduce((sum, count) => sum + count, 0),
            failedKeyIds: Array.from(this.failedKeys)
        };
    }
}

let apiKeyManager = null;

// --- HELPER FUNCTIONS (updated for simplified JSON) ---
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

// --- FONT VALIDATION FUNCTIONS ---
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
    
    console.log(`✅ Using font size: ${size}pt`);
    return size;
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

// --- ENHANCED MAIN MOCK GENERATION FUNCTION ---
async function generateSingleMock(contents, outputPath, mockNumber, totalMocks, options) {
    const maxRetries = 3;
    let lastError = null;
    let currentKeyInfo = null;
    let lastErrorInfo = null;

    // Assign a dedicated key to this mock
    try {
        currentKeyInfo = apiKeyManager.assignKeyToMock(mockNumber);
        console.log(`🔑 Mock ${mockNumber}/${totalMocks} assigned to API Key ${currentKeyInfo.index + 1}`);
    } catch (error) {
        const errorInfo = analyzeApiError(error, { mockNumber });
        console.error(formatDetailedError(errorInfo, mockNumber));
        return {
            success: false,
            error: error,
            errorInfo: errorInfo,
            outputPath: outputPath
        };
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            // Get the assigned key for this mock
            currentKeyInfo = apiKeyManager.getKeyForMock(mockNumber);
            
            const requestDetails = {
                model: options.model,
                attempt: attempt,
                maxRetries: maxRetries,
                keyIndex: currentKeyInfo.index,
                mockNumber: mockNumber,
                contentSize: JSON.stringify(contents).length
            };
            
            console.log(`🔄 Mock ${mockNumber}/${totalMocks} - Attempt ${attempt}/${maxRetries}`);
            console.log(`   └── API Key: #${currentKeyInfo.index + 1} | Model: ${options.model} | Content: ${requestDetails.contentSize} chars`);
            
            const genAI = new GoogleGenAI({ apiKey: currentKeyInfo.key });
            
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
                console.log(`   └── Rate limit delay: ${adjustedDelay}ms`);
                await new Promise(resolve => setTimeout(resolve, adjustedDelay));
            }
            
            console.log(`   └── Sending request to Gemini API...`);
            const requestStartTime = Date.now();
            
            const response = await genAI.models.generateContent(requestParams);
            
            const requestEndTime = Date.now();
            const requestDuration = requestEndTime - requestStartTime;
            console.log(`   └── API Response received in ${requestDuration}ms`);
            
            if (!response || !response.text) {
                throw new Error("No response received from API - response object is null or missing text property");
            }
            
            const generatedJson = response.text;
            
            if (!generatedJson || generatedJson.trim().length === 0) {
                throw new Error("Empty response received from API - generated content is null or empty");
            }

            console.log(`   └── Response length: ${generatedJson.length} characters`);

            // Log token usage if available
            if (response.usageMetadata) {
                const usage = response.usageMetadata;
                console.log(`   └── Token usage - Input: ${usage.promptTokenCount || 'N/A'}, Output: ${usage.candidatesTokenCount || 'N/A'}, Thinking: ${usage.thoughtsTokenCount || 'N/A'}`);
            }

            // Parse and validate simplified JSON
            let jsonData;
            try {
                console.log(`   └── Parsing JSON response...`);
                // Clean the response - remove any markdown formatting if present
                let cleanJson = generatedJson.trim();
                if (cleanJson.startsWith('```json')) {
                    cleanJson = cleanJson.replace(/^```json\s*/, '').replace(/\s*```$/, '');
                    console.log(`   └── Removed JSON markdown formatting`);
                } else if (cleanJson.startsWith('```')) {
                    cleanJson = cleanJson.replace(/^```\s*/, '').replace(/\s*```$/, '');
                    console.log(`   └── Removed generic markdown formatting`);
                }
                
                // Clean control characters
                const sanitizedJson = cleanJson.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
                
                jsonData = JSON.parse(sanitizedJson);
                console.log(`   └── JSON parsed successfully`);
            } catch (parseError) {
                const detailedParseError = new Error(`Failed to parse JSON response: ${parseError.message}\n` +
                    `Response preview (first 500 chars): ${generatedJson.substring(0, 500)}...`);
                throw detailedParseError;
            }

            // Validate simplified JSON structure
            console.log(`   └── Validating simplified JSON structure...`);
            const validationErrors = [];
            if (!jsonData.examTitle) validationErrors.push('missing examTitle');
            if (!jsonData.examDetails) validationErrors.push('missing examDetails');
            if (!jsonData.sections) validationErrors.push('missing sections');
            if (!Array.isArray(jsonData.sections)) validationErrors.push('sections is not an array');
            
            // Validate each section has questions array
            if (jsonData.sections) {
                jsonData.sections.forEach((section, index) => {
                    if (!section.questions || !Array.isArray(section.questions)) {
                        validationErrors.push(`section ${index} missing questions array`);
                    }
                });
            }
            
            if (validationErrors.length > 0) {
                throw new Error(`Invalid simplified JSON structure - ${validationErrors.join(', ')}`);
            }
            console.log(`   └── Simplified JSON structure validation passed`);

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
                    console.log(`   └── [DEBUG] Raw JSON saved to: ${debugJsonPath}`);
                } catch(e) {
                    console.error(`   └── [DEBUG] Failed to save debug JSON: ${e.message}`);
                }
            }

            // Convert simplified JSON to HTML with font options
            console.log(`   └── Converting simplified JSON to HTML...`);
            const htmlContent = convertJsonToHtml(jsonData, fontOptions);

            // Save debug HTML file if requested
            if (options.saveHtml) {
                const debugHtmlPath = generateDebugHtmlFilename(options.output, mockNumber, totalMocks);
                try {
                    await fs.writeFile(debugHtmlPath, htmlContent);
                    console.log(`   └── [DEBUG] HTML saved to: ${debugHtmlPath}`);
                } catch(e) {
                    console.error(`   └── [DEBUG] Failed to save debug HTML: ${e.message}`);
                }
            }

            // Generate PDF with font options
            console.log(`   └── Generating PDF: ${path.basename(outputPath)}`);
            await generatePdf(htmlContent, outputPath, fontOptions);

            // Generate PPT if requested with font options
            if (options.ppt) {
                const pptOutputPath = generateOutputFilename(options.output, mockNumber, totalMocks, '.pptx');
                const backgroundPath = options.pptBackground || null;
                console.log(`   └── Generating PowerPoint: ${path.basename(pptOutputPath)}`);
                await generatePptFromJson(jsonData, pptOutputPath, backgroundPath, fontOptions);
            }
            
            // Update usage stats
            apiKeyManager.incrementUsage(currentKeyInfo.index);
            
            console.log(`✅ Mock ${mockNumber}/${totalMocks} completed successfully!`);
            console.log(`   └── Output: ${path.basename(outputPath)}`);
            console.log(`   └── API Key: #${currentKeyInfo.index + 1} | Content: ${generatedJson.length} chars`);
            console.log(`   └── Font: ${fontOptions.fontName} (${fontOptions.fontSize}pt)`);
            
            return {
                success: true,
                outputPath: outputPath,
                contentLength: generatedJson.length,
                keyIndex: currentKeyInfo.index,
                usage: response.usageMetadata,
                mockNumber: mockNumber,
                jsonData: jsonData,
                fontOptions: fontOptions,
                requestDuration: requestDuration
            };

        } catch (error) {
            lastError = error;
            
            // Enhanced error analysis
            const requestDetails = {
                model: options.model,
                attempt: attempt,
                maxRetries: maxRetries,
                keyIndex: currentKeyInfo?.index,
                mockNumber: mockNumber,
                contentSize: JSON.stringify(contents).length
            };
            
            lastErrorInfo = analyzeApiError(error, requestDetails);
            
            // Determine if this is a quota/rate limit error
            const isQuotaError = lastErrorInfo.category === 'quota' || 
                               lastErrorInfo.type === 'quota_exceeded';
            
            // Log detailed error information
            console.error(formatDetailedError(lastErrorInfo, mockNumber));
            
            if (isQuotaError && currentKeyInfo) {
                // Mark key as failed and try to get alternative
                apiKeyManager.markKeyAsFailed(currentKeyInfo.index, error, lastErrorInfo);
                
                // Try to get a different available key for retry
                try {
                    const newKeyInfo = apiKeyManager.getNextAvailableKey(currentKeyInfo.index);
                    currentKeyInfo = newKeyInfo;
                    apiKeyManager.keyAssignments.set(mockNumber, currentKeyInfo.index);
                    console.log(`🔄 Mock ${mockNumber} switched to API Key ${currentKeyInfo.index + 1} for retry`);
                    
                    // Don't count this as a retry attempt since it's a key switch
                    attempt--;
                    continue;
                } catch (keyError) {
                    console.error(`\n🚨 CRITICAL: No alternative API keys available!`);
                    const keyErrorInfo = analyzeApiError(keyError, requestDetails);
                    console.error(formatDetailedError(keyErrorInfo, mockNumber));
                    logApiErrorStats(lastErrorInfo, apiKeyManager);
                    break;
                }
            }
            
            // Log attempt-specific error details
            console.error(`\n⚠️  ATTEMPT ${attempt}/${maxRetries} FAILED:`);
            console.error(`   └── Error Type: ${lastErrorInfo.type}`);
            console.error(`   └── Category: ${lastErrorInfo.category}`);
            console.error(`   └── Retriable: ${lastErrorInfo.isRetriable ? 'Yes' : 'No'}`);
            
            if (attempt === maxRetries) {
                console.error(`\n💥 FINAL FAILURE - Mock ${mockNumber}/${totalMocks}:`);
                console.error(`   └── All ${maxRetries} attempts exhausted`);
                console.error(`   └── Last error type: ${lastErrorInfo.type}`);
                console.error(`   └── API Key used: #${currentKeyInfo?.index + 1 || 'unknown'}`);
                
                // Log key error history if available
                if (currentKeyInfo && apiKeyManager.getKeyErrorHistory(currentKeyInfo.index).length > 0) {
                    console.error(`\n📜 ERROR HISTORY FOR API KEY #${currentKeyInfo.index + 1}:`);
                    const history = apiKeyManager.getKeyErrorHistory(currentKeyInfo.index);
                    history.slice(-3).forEach((record, idx) => {
                        console.error(`   ${idx + 1}. [${record.timestamp}] ${record.type}: ${record.message.substring(0, 100)}...`);
                    });
                }
                
                logApiErrorStats(lastErrorInfo, apiKeyManager);
                break;
            }
            
            // Enhanced retry logic with exponential backoff
            if (lastErrorInfo.isRetriable) {
                const baseWaitTime = 1000; // 1 second base
                const waitTime = baseWaitTime * Math.pow(2, attempt - 1); // Exponential backoff
                console.log(`⏳ Waiting ${waitTime}ms before retry (exponential backoff)...`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
            } else {
                console.error(`   └── Error is not retriable, skipping remaining attempts`);
                break;
            }
        }
    }

    // Final failure with comprehensive error report
    console.error(`\n💀 MOCK GENERATION COMPLETELY FAILED:`);
    console.error(`   └── Mock: ${mockNumber}/${totalMocks}`);
    console.error(`   └── Output Path: ${outputPath}`);
    console.error(`   └── Final Error: ${lastError?.message || 'Unknown error'}`);
    
    if (lastErrorInfo) {
        console.error(`   └── Error Analysis:`);
        console.error(`       ├── Type: ${lastErrorInfo.type}`);
        console.error(`       ├── Category: ${lastErrorInfo.category}`);
        console.error(`       ├── Retriable: ${lastErrorInfo.isRetriable}`);
        console.error(`       └── Suggested Action: ${lastErrorInfo.suggestedAction}`);
    }

    return {
        success: false,
        error: lastError,
        errorInfo: lastErrorInfo,
        outputPath: outputPath,
        attempts: maxRetries,
        keyIndex: currentKeyInfo?.index
    };
}

// --- MAIN EXECUTION LOGIC WITH ENHANCED ERROR REPORTING ---
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
        .option("--fontname <name>", "Font name for outputs (e.g., 'Times New Roman'). Ensure font is available on the system.", "Arial")
        .option("--fontsize <size>", "Base font size in points (6-54, default: 11)", parseFloat, 11)
        .parse(process.argv);

    const options = program.opts();
    const apiKeyFile = options.apiKeyFile || "api_key.txt";
    const numberOfMocks = parseInt(options.numberOfMocks) || 1; 
    const maxConcurrent = options.concurrentLimit || 3;
    const rateDelay = options.rateLimitDelay || 1000;
    const thinkingBudget = options.thinkingBudget;
    const modelName = options.model || "gemini-2.5-flash";

    if (!numberOfMocks || isNaN(numberOfMocks) || numberOfMocks < 1) {
        console.error(`❌ CONFIGURATION ERROR:`);
        console.error(`   └── --number-of-mocks must be a positive integer`);
        console.error(`   └── Received: ${numberOfMocks} (type: ${typeof numberOfMocks})`);
        process.exit(1);
    }

    // Validate and set font options
    const validatedFontName = validateFontName(options.fontname);
    const validatedFontSize = validateFontSize(options.fontsize);
    
    // Update options with validated font settings
    options.fontName = validatedFontName;
    options.fontSize = validatedFontSize;

    // Enhanced dependency checking
    console.log(`🔍 DEPENDENCY VERIFICATION:`);
    try {
        await import('puppeteer');
        console.log('   ✅ Puppeteer available - PDF generation enabled');
    } catch (error) {
        console.error(`   ❌ CRITICAL DEPENDENCY MISSING:`);
        console.error(`      └── Puppeteer is required for PDF generation`);
        console.error(`      └── Error: ${error.message}`);
        console.error(`      └── Install with: npm install puppeteer`);
        process.exit(1);
    }

    if (options.ppt) {
        try {
            await import('pptxgenjs');
            console.log('   ✅ PptxGenJS available - PowerPoint generation enabled');
        } catch (error) {
            console.error(`   ❌ POWERPOINT DEPENDENCY MISSING:`);
            console.error(`      └── PptxGenJS is required for PowerPoint generation`);
            console.error(`      └── Error: ${error.message}`);
            console.error(`      └── Install with: npm install pptxgenjs`);
            process.exit(1);
        }
    }

    try {
        // 1. Validate directories first
        console.log("\n📁 DIRECTORY VALIDATION:");
        try {
            await validateDirectories(options.pyq, options.referenceMock);
            console.log(`   ✅ PYQ directory: ${options.pyq}`);
            console.log(`   ✅ Reference mock directory: ${options.referenceMock}`);
        } catch (dirError) {
            console.error(`   ❌ DIRECTORY ERROR:`);
            console.error(`      └── ${dirError.message}`);
            process.exit(1);
        }

        // 2. Enhanced API Key Setup
        console.log(`\n🔑 API KEY CONFIGURATION:`);
        console.log(`   └── Reading from: ${apiKeyFile}`);
        let apiKeys = [];
        try {
            const apiKeyContent = await fs.readFile(apiKeyFile, "utf-8");
            const rawKeys = apiKeyContent.split('\n').map(key => key.trim()).filter(key => key.length > 0);
            
            console.log(`   └── Found ${rawKeys.length} key(s) in file`);
            
            apiKeys = rawKeys.map((key, index) => {
                try {
                    return validateApiKey(key);
                } catch (keyError) {
                    console.error(`   ❌ Invalid API key #${index + 1}: ${keyError.message}`);
                    return null;
                }
            }).filter(key => key !== null);
            
            if (apiKeys.length === 0) {
                throw new Error("No valid API keys found after validation");
            }
            
            console.log(`   ✅ Validated ${apiKeys.length} API key(s)`);
            
        } catch (error) {
            console.error(`\n❌ API KEY ERROR:`);
            if (error.code === 'ENOENT') {
                console.error(`   └── File '${apiKeyFile}' not found`);
                console.error(`   └── Please create this file with your API key(s) (one per line)`);
                console.error(`   └── Example content:`);
                console.error(`       AIzaSyC... (your first API key)`);
                console.error(`       AIzaSyD... (your second API key, optional)`);
            } else {
                console.error(`   └── ${error.message}`);
            }
            process.exit(1);
        }

        apiKeyManager = new ApiKeyManager(apiKeys);

        // 3. Read user prompt file with enhanced error handling
        console.log(`\n📝 PROMPT FILE PROCESSING:`);
        let userPrompt = "";
        try {
            userPrompt = await fs.readFile(options.prompt, "utf-8");
            console.log(`   ✅ Loaded prompt from: ${options.prompt}`);
            console.log(`   └── Prompt length: ${userPrompt.length} characters`);
        } catch (error) {
            console.error(`\n❌ PROMPT FILE ERROR:`);
            console.error(`   └── File: ${options.prompt}`);
            console.error(`   └── Error: ${error.message}`);
            if (error.code === 'ENOENT') {
                console.error(`   └── File does not exist - please check the path`);
            } else if (error.code === 'EACCES') {
                console.error(`   └── Permission denied - check file permissions`);
            }
            process.exit(1);
        }

        if (!userPrompt.trim()) {
            console.error(`❌ PROMPT VALIDATION ERROR:`);
            console.error(`   └── Prompt file is empty or contains only whitespace`);
            console.error(`   └── Please add your mock test requirements to: ${options.prompt}`);
            process.exit(1);
        }

        // 4. Enhanced PDF File Processing
        console.log("\n📚 INPUT FILE PROCESSING:");
        let pyqFiles = [];
        let refMockFiles = [];
        
        try {
            pyqFiles = await findPdfFiles(options.pyq);
            console.log(`   └── PYQ PDFs found: ${pyqFiles.length}`);
            pyqFiles.forEach(file => console.log(`       └── ${path.basename(file)}`));
        } catch (error) {
            console.error(`   ❌ PYQ directory error: ${error.message}`);
        }
        
        try {
            refMockFiles = await findPdfFiles(options.referenceMock);
            console.log(`   └── Reference mock PDFs found: ${refMockFiles.length}`);
            refMockFiles.forEach(file => console.log(`       └── ${path.basename(file)}`));
        } catch (error) {
            console.error(`   ❌ Reference mock directory error: ${error.message}`);
        }

        if (pyqFiles.length === 0 && refMockFiles.length === 0) {
            console.error(`\n❌ INPUT FILE ERROR:`);
            console.error(`   └── No PDF files found in either directory`);
            console.error(`   └── PYQ Directory: ${options.pyq} (${pyqFiles.length} files)`);
            console.error(`   └── Reference Directory: ${options.referenceMock} (${refMockFiles.length} files)`);
            console.error(`   └── Please ensure PDF files exist in at least one directory`);
            process.exit(1);
        }

        console.log(`\n📄 FILE CONVERSION TO API FORMAT:`);
        const pyqParts = await filesToGenerativeParts(pyqFiles, "PYQ");
        const refMockParts = await filesToGenerativeParts(refMockFiles, "Reference Mock");
        
        console.log(`   └── PYQ parts processed: ${pyqParts.length}`);
        console.log(`   └── Reference mock parts processed: ${refMockParts.length}`);

        if (pyqParts.length === 0 && refMockParts.length === 0) {
            console.error(`\n❌ FILE PROCESSING ERROR:`);
            console.error(`   └── No valid PDF files could be processed`);
            console.error(`   └── All files may be corrupted, too large (>20MB), or inaccessible`);
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

        const totalContentSize = JSON.stringify(contents).length;
        console.log(`   └── Total request content size: ${(totalContentSize / 1024).toFixed(2)} KB`);

        // 6. Enhanced Mock Test Generation
        console.log(`\n🚀 MOCK TEST GENERATION STARTING:`);
        console.log(`┌${'─'.repeat(60)}`);
        console.log(`│ Configuration Summary:`);
        console.log(`│ Number of Mocks: ${numberOfMocks}`);
        console.log(`│ Model: ${modelName}`);
        console.log(`│ Max Concurrent: ${maxConcurrent}`);
        console.log(`│ Rate Limit Delay: ${rateDelay}ms`);
        console.log(`│ Max Tokens: ${options.maxTokens}`);
        console.log(`│ Temperature: ${options.temperature}`);
        if (options.thinkingBudget !== undefined) {
            console.log(`│ Thinking Budget: ${options.thinkingBudget}`);
        }
        console.log(`│ Font: ${validatedFontName} (${validatedFontSize}pt)`);
        console.log(`│ Schema: Simplified JSON (flat structure)`);
        
        let outputFormats = ["JSON", "PDF"];
        if (options.ppt) outputFormats.push("PowerPoint");
        console.log(`│ Output Formats: ${outputFormats.join(', ')}`);
        
        if (options.saveJson) console.log(`│ Debug JSON: Enabled`);
        if (options.saveHtml) console.log(`│ Debug HTML: Enabled`);
        console.log(`└${'─'.repeat(60)}`);
        
        const startTime = Date.now();
        
        const generationTasks = [];
        for (let i = 1; i <= numberOfMocks; i++) {
            const outputPath = generateOutputFilename(options.output, i, numberOfMocks, '.pdf');
            // Wrap in an anonymous function to delay execution
            generationTasks.push(() => generateSingleMock(contents, outputPath, i, numberOfMocks, options));
        }

        // Execute tasks with concurrency limit
        console.log(`\n⚡ EXECUTING GENERATION TASKS:`);
        console.log(`   └── Processing in batches of ${maxConcurrent}`);
        
        const results = [];
        for(let i=0; i<generationTasks.length; i+=maxConcurrent) {
            const batchNumber = Math.floor(i / maxConcurrent) + 1;
            const totalBatches = Math.ceil(generationTasks.length / maxConcurrent);
            const batch = generationTasks.slice(i, i+maxConcurrent).map(task => task());
            
            console.log(`\n📦 BATCH ${batchNumber}/${totalBatches} - Processing ${batch.length} mock(s)...`);
            const batchResults = await Promise.allSettled(batch);
            results.push(...batchResults);
            
            // Log batch completion
            const batchSuccessful = batchResults.filter(r => r.status === 'fulfilled' && r.value.success).length;
            const batchFailed = batchResults.length - batchSuccessful;
            console.log(`   └── Batch ${batchNumber} completed: ${batchSuccessful} successful, ${batchFailed} failed`);
        }
        
        const endTime = Date.now();
        const totalTime = (endTime - startTime) / 1000;

        // Enhanced Results Processing
        const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).map(r => r.value);
        const failed = results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success));

        console.log(`\n📊 GENERATION SUMMARY REPORT:`);
        console.log(`┌${'─'.repeat(60)}`);
        console.log(`│ Overall Results:`);
        console.log(`│ ✅ Successful: ${successful.length}/${numberOfMocks} (${(successful.length/numberOfMocks*100).toFixed(1)}%)`);
        console.log(`│ ❌ Failed: ${failed.length}/${numberOfMocks} (${(failed.length/numberOfMocks*100).toFixed(1)}%)`);
        console.log(`│ ⏱️  Total Time: ${totalTime.toFixed(2)} seconds`);
        console.log(`│ ⚡ Average Time per Mock: ${(totalTime/numberOfMocks).toFixed(2)}s`);
        console.log(`├${'─'.repeat(60)}`);
        
        if (apiKeyManager) {
            const stats = apiKeyManager.getOverallStats();
            console.log(`│ API Key Statistics:`);
            console.log(`│ Total Keys: ${stats.totalKeys}`);
            console.log(`│ Active Keys: ${stats.activeKeys}`);
            console.log(`│ Failed Keys: ${stats.failedKeys}`);
            console.log(`│ Total API Requests: ${stats.totalRequests}`);
            console.log(`├${'─'.repeat(60)}`);
        }
        
        if (successful.length > 0) {
            console.log(`│ Successfully Generated Files:`);
            successful.sort((a,b) => a.mockNumber - b.mockNumber).forEach(mockResult => {
                const duration = mockResult.requestDuration ? ` (${mockResult.requestDuration}ms)` : '';
                console.log(`│ 📄 Mock ${mockResult.mockNumber}: ${path.basename(mockResult.outputPath)}${duration}`);
                console.log(`│    └── Size: ${mockResult.contentLength} chars | Key: #${mockResult.keyIndex + 1}`);
                
                if (options.ppt) {
                    const pptOutputPath = generateOutputFilename(options.output, mockResult.mockNumber, numberOfMocks, '.pptx');
                    console.log(`│    └── PowerPoint: ${path.basename(pptOutputPath)}`);
                }
                if (options.saveJson) {
                    const debugJsonPath = generateDebugJsonFilename(options.output, mockResult.mockNumber, numberOfMocks);
                    console.log(`│    └── Debug JSON: ${path.basename(debugJsonPath)}`);
                }
                if (options.saveHtml) {
                    const debugHtmlPath = generateDebugHtmlFilename(options.output, mockResult.mockNumber, numberOfMocks);
                    console.log(`│    └── Debug HTML: ${path.basename(debugHtmlPath)}`);
                }
            });
            console.log(`├${'─'.repeat(60)}`);
            console.log(`│ Typography Settings Applied:`);
            console.log(`│ Font Family: ${validatedFontName}`);
            console.log(`│ Base Font Size: ${validatedFontSize}pt`);
        }

        if (failed.length > 0) {
            console.log(`│ Failed Generations - Detailed Breakdown:`);
            failed.forEach((result, i) => {
                const mockValue = result.value;
                const error = result.reason || mockValue?.error;
                const errorInfo = mockValue?.errorInfo;
                const outputPath = mockValue?.outputPath || `Unknown mock ${i+1}`;
                
                console.log(`│ ❌ ${path.basename(outputPath)}:`);
                console.log(`│    └── Error: ${error?.message?.substring(0, 80) || 'Unknown error'}...`);
                
                if (errorInfo) {
                    console.log(`│    └── Type: ${errorInfo.type} | Category: ${errorInfo.category}`);
                    console.log(`│    └── Retriable: ${errorInfo.isRetriable} | Key: #${mockValue.keyIndex + 1 || 'N/A'}`);
                    console.log(`│    └── Action: ${errorInfo.suggestedAction.substring(0, 60)}...`);
                }
            });
        }
        
        console.log(`└${'─'.repeat(60)}`);

        // Enhanced final error analysis
        if (failed.length > 0) {
            console.log(`\n🔍 FAILURE ANALYSIS:`);
            
            // Group failures by error type
            const errorGroups = {};
            failed.forEach(result => {
                const errorInfo = result.value?.errorInfo;
                const errorType = errorInfo?.type || 'unknown';
                if (!errorGroups[errorType]) {
                    errorGroups[errorType] = [];
                }
                errorGroups[errorType].push(result);
            });
            
            Object.entries(errorGroups).forEach(([errorType, failures]) => {
                console.log(`   └── ${errorType}: ${failures.length} occurrence(s)`);
                if (failures.length > 0 && failures[0].value?.errorInfo) {
                    console.log(`       └── Suggested Action: ${failures[0].value.errorInfo.suggestedAction}`);
                }
            });
            
            // Provide specific recommendations
            console.log(`\n💡 TROUBLESHOOTING RECOMMENDATIONS:`);
            if (errorGroups['quota_exceeded']) {
                console.log(`   └── Quota Issues: Try using different API keys or wait for quota reset`);
            }
            if (errorGroups['network_error'] || errorGroups['timeout']) {
                console.log(`   └── Network Issues: Check internet connection and try again`);
            }
            if (errorGroups['invalid_api_key']) {
                console.log(`   └── API Key Issues: Verify keys are correct and have proper permissions`);
            }
            if (errorGroups['content_too_large']) {
                console.log(`   └── Content Size Issues: Reduce input PDF size or split requests`);
            }
        }

        if (successful.length === 0) {
            console.error(`\n💀 COMPLETE FAILURE - NO MOCKS GENERATED:`);
            console.error(`   └── All ${numberOfMocks} mock test generations failed`);
            console.error(`   └── Review the detailed error reports above`);
            console.error(`   └── Check API keys, network connection, and input files`);
            
            if (apiKeyManager) {
                logApiErrorStats(null, apiKeyManager);
            }
            
            process.exit(1);
        }

        // Success summary
        console.log(`\n🎉 GENERATION COMPLETED SUCCESSFULLY!`);
        console.log(`   └── Generated: ${successful.length}/${numberOfMocks} mock test(s)`);
        console.log(`   └── Success Rate: ${(successful.length/numberOfMocks*100).toFixed(1)}%`);
        console.log(`   └── Total Time: ${totalTime.toFixed(2)}s`);
        console.log(`   └── Average per Mock: ${(totalTime/successful.length).toFixed(2)}s`);
        console.log(`   └── Using Simplified JSON Schema (flat structure)`);

    } catch (error) {
        console.error(`\n💥 FATAL ERROR - PROGRAM TERMINATED:`);
        console.error(`┌${'─'.repeat(60)}`);
        console.error(`│ Error Details:`);
        console.error(`│ Type: ${error.constructor.name}`);
        console.error(`│ Message: ${error.message}`);
        console.error(`│ Timestamp: ${new Date().toISOString()}`);
        console.error(`├${'─'.repeat(60)}`);
        console.error(`│ Stack Trace:`);
        const stackLines = error.stack?.split('\n') || ['No stack trace available'];
        stackLines.slice(0, 5).forEach(line => {
            console.error(`│ ${line.trim()}`);
        });
        console.error(`└${'─'.repeat(60)}`);
        
        if (apiKeyManager) {
            logApiErrorStats(null, apiKeyManager);
        }
        
        process.exit(1);
    }
}

// Enhanced unhandled rejection handler
process.on('unhandledRejection', (reason, promise) => {
    console.error(`\n💥 UNHANDLED PROMISE REJECTION:`);
    console.error(`┌${'─'.repeat(60)}`);
    console.error(`│ Promise: ${promise}`);
    console.error(`│ Reason: ${reason}`);
    console.error(`│ Timestamp: ${new Date().toISOString()}`);
    console.error(`└${'─'.repeat(60)}`);
    
    if (reason instanceof Error) {
        console.error(`Stack trace: ${reason.stack}`);
    }
    
    process.exit(1);
});

// Enhanced uncaught exception handler
process.on('uncaughtException', (error) => {
    console.error(`\n💥 UNCAUGHT EXCEPTION:`);
    console.error(`┌${'─'.repeat(60)}`);
    console.error(`│ Error: ${error.message}`);
    console.error(`│ Type: ${error.constructor.name}`);
    console.error(`│ Timestamp: ${new Date().toISOString()}`);
    console.error(`├${'─'.repeat(60)}`);
    console.error(`│ Stack Trace:`);
    const stackLines = error.stack?.split('\n') || ['No stack trace available'];
    stackLines.forEach(line => {
        console.error(`│ ${line.trim()}`);
    });
    console.error(`└${'─'.repeat(60)}`);
    process.exit(1);
});

// Run the main function with enhanced error handling
main().catch(error => {
    console.error(`\n💥 MAIN FUNCTION FATAL ERROR:`);
    console.error(`┌${'─'.repeat(60)}`);
    console.error(`│ This should not happen - main() should handle all errors`);
    console.error(`│ Error: ${error.message}`);
    console.error(`│ Type: ${error.constructor.name}`);
    console.error(`│ Timestamp: ${new Date().toISOString()}`);
    console.error(`└${'─'.repeat(60)}`);
    console.error(`Stack trace: ${error.stack}`);
    process.exit(1);
});
