import { GoogleGenAI } from "@google/genai";
import { program } from "commander";
import * as fs from "fs/promises";
import * as path from "path";
import puppeteer from "puppeteer";
import PptxGenJS from 'pptxgenjs';

const systemPrompt= `You are an expert exam designer and question creator specializing in competitive entrance exams. Your primary task is to generate a BRAND NEW, high-quality mock test and output it as a single, complete, and valid JSON object.

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

4.  **Data Interpretation (DI) Chart Specifications:**
   *   For DI questions, instead of SVG diagrams, provide chart data in structured format.
   *   Use the "chartData" field for native PowerPoint chart generation.
   *   Supported chart types: "bar", "column", "line", "pie", "doughnut", "area"
   *   Chart data structure:
     {
       "chartType": "bar|column|line|pie|doughnut|area",
       "title": "Chart Title",
       "data": [
         {
           "name": "Category/Series Name",
           "labels": ["Label1", "Label2", "Label3"],
           "values": [10, 20, 30]
         }
       ],
       "options": {
         "showLegend": true,
         "showDataLabels": true,
         "colors": ["#FF6B6B", "#4ECDC4", "#45B7D1"]
       }
     }

5.  **Format as a Single, Complete JSON Object:**
   *   The ENTIRE output MUST be a single JSON object. Do not wrap it in any formatting or add any text outside the JSON structure.
   *   CRITICAL: To avoid JSON parsing errors, prefer plain text formatting in explanations over HTML tags.
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
                 "chartData": "Object | null",
                 "options": [
                   {
                     "label": "String",
                     "text": "String",
                     "svg": "String | null",
                     "chartData": "Object | null"
                   }
                 ],
                 "solution": {
                   "answer": "String",
                   "explanation": "String",
                   "svg": "String | null",
                   "chartData": "Object | null"
                 }
               }
             ]
           }
         ]
       }
     ]
   }

6.  **Content Rules:**
   *   For Data Interpretation questions, always provide chartData instead of svg
   *   For mathematical/geometric diagrams, continue using svg
   *   Ensure every question has a corresponding solution with a clear answer and explanation
   *   Generate realistic data that supports logical DI questions
   *   Create proper chart titles and axis labels for clarity`;


// --- UPDATED SYSTEM PROMPT FOR JSON OUTPUT ---
/* const systemPrompt = `You are an expert exam designer and question creator specializing in competitive entrance exams. Your primary task is to generate a BRAND NEW, high-quality mock test and output it as a single, complete, and valid JSON object.

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
    \`\`\`

5.  **Diagram Generation (SVG):**
    *   For any question, option, or solution requiring a diagram, you MUST provide a clear, well-labeled diagram.
    *   All diagrams must be drawn using **inline SVG** string elements embedded directly in the \`svg\` fields of the JSON. Ensure the SVG is a complete and valid string.
   *   Use simple shapes: rect, circle, line, text elements only.
   *   Use basic colors: black, white, gray only.
   *   Escape SVG properly: replace < with \\u003c and > with \\u003e in JSON.
   *   Ensure SVG is valid and renders correctly.


6.  **Content Rules:**
    *   Ensure every question has a corresponding solution with a clear answer and explanation.
    *   The \`questionNumber\` for each question must be unique.
    *   Generate content based on the user prompt and reference materials, ensuring it is logical, solvable, and free of contradictions.`;
 */

// --- JSON TO HTML CONVERSION ---

function convertJsonToHtmlWithDI(jsonData) {
    // Enhanced HTML template that can handle chart data visualization
    const chartToHtmlTable = (chartData) => {
        if (!chartData || !chartData.data) return '[Chart data not available]';

        const { chartType, title, data } = chartData;
        let html = `<div class="chart-placeholder">
            <h4>${title || 'Chart'} (${chartType.toUpperCase()})</h4>
            <table border="1" style="border-collapse: collapse; margin: 10px 0;">`;

        if (chartType === 'pie' || chartType === 'doughnut') {
            html += '<tr><th>Category</th><th>Value</th></tr>';
            if (data[0]) {
                data[0].labels.forEach((label, index) => {
                    html += `<tr><td>${label}</td><td>${data[0].values[index] || 0}</td></tr>`;
                });
            }
        } else {
            // For other chart types, create a table with series as columns
            const categories = data[0]?.labels || [];
            html += '<tr><th>Category</th>';
            data.forEach(series => {
                html += `<th>${series.name}</th>`;
            });
            html += '</tr>';

            categories.forEach((category, index) => {
                html += `<tr><td>${category}</td>`;
                data.forEach(series => {
                    html += `<td>${series.values[index] || 0}</td>`;
                });
                html += '</tr>';
            });
        }

        html += '</table></div>';
        return html;
    };

    // Your existing HTML generation code with modifications to handle chartData
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${jsonData.examTitle}</title>
    <style>
        /* Your existing styles plus chart placeholder styles */
        .chart-placeholder {
            border: 2px dashed #ccc;
            padding: 15px;
            margin: 15px 0;
            text-align: center;
            background-color: #f9f9f9;
            border-radius: 8px;
        }

        .chart-placeholder h4 {
            margin: 0 0 10px 0;
            color: #666;
        }

        .chart-placeholder table {
            margin: 0 auto;
            background: white;
            border-radius: 4px;
        }

        .chart-placeholder th {
            background-color: #f0f0f0;
            padding: 8px 12px;
            font-weight: bold;
        }

        .chart-placeholder td {
            padding: 6px 12px;
            text-align: center;
        }

        /* Rest of your existing CSS */
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

        /* Include all your existing CSS styles here... */
    </style>
</head>
<body>
    <!-- Your existing HTML structure with modifications for charts -->
    ${jsonData.sections.map(section => `
        ${section.questionSets.map(questionSet => `
            ${questionSet.questions.map(question => `
                <div class="question">
                    <span class="question-number">${question.questionNumber}.</span>
                    <div class="question-text">${question.questionText}</div>

                    ${question.chartData ? chartToHtmlTable(question.chartData) : ''}
                    ${question.svg && !question.chartData ? `
                        <div class="svg-container">
                            ${question.svg}
                        </div>
                    ` : ''}

                    <div class="options">
                        ${question.options.map(option => `
                            <div class="option">
                                <strong>${option.label})</strong> ${option.text || ''}
                                ${option.chartData ? chartToHtmlTable(option.chartData) : ''}
                                ${option.svg && !option.chartData ? `
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


function createQuestionSlideWithDI(pptx, question, directions, bgImagePath) {
    const slide = addSlideWithBackground(pptx, bgImagePath);
    
    slide.addText(`Question ${question.questionNumber}`, {
        x: 0.5,
        y: 0.4,
        w: '90%',
        fontSize: 24,
        bold: true,
        color: '1A365D'
    });

    let currentY = 1.0;
    
    // Add question text
    const questionTextHeight = question.questionText.length > 200 ? 1.2 : 0.8;
    slide.addText(convertHtmlToPptxRichText(question.questionText), {
        x: 0.5,
        y: currentY,
        w: '90%',
        h: questionTextHeight,
        fontSize: 16
    });

    currentY += questionTextHeight + 0.15;

    // Check if this is a DI question with chart data
    if (question.chartData) {
        // Use native PptxGenJS chart instead of SVG
        const chartSuccess = createDIChart(slide, question.chartData, {
            x: 0.5,
            y: currentY,
            w: 9,
            h: 3.5
        });
        
        if (chartSuccess) {
            currentY += 3.7;
        } else {
            console.warn(`Failed to create chart for question ${question.questionNumber}, falling back to text description`);
            slide.addText(`[Chart: ${question.chartData.title || 'Data Visualization'}]`, {
                x: 0.5,
                y: currentY,
                w: '90%',
                h: 0.5,
                fontSize: 14,
                color: '666666',
                italic: true
            });
            currentY += 0.7;
        }
    } else if (question.svg) {
        // Use SVG for non-DI diagrams
        const base64Svg = svgToBase64(question.svg);
        if (base64Svg) {
            slide.addImage({
                data: base64Svg,
                x: 2.5,
                y: currentY,
                w: 5,
                h: 3
            });
            currentY += 3.2;
        }
    }

    // Add options with chart support
    question.options.forEach(opt => {
        if (opt.chartData) {
            // Option has its own chart data
            slide.addText(`${opt.label})`, {
                x: 0.75,
                y: currentY,
                w: 1,
                h: 0.4,
                fontSize: 14,
                bold: true
            });
            
            const optionChartSuccess = createDIChart(slide, opt.chartData, {
                x: 1.75,
                y: currentY - 0.2,
                w: 3,
                h: 1.5
            });
            
            currentY += optionChartSuccess ? 1.8 : 0.5;
            
        } else {
            // Regular text option
            const optionText = `${opt.label}) ${opt.text || ''}`;
            if (opt.svg) {
                slide.addText(`${opt.label})`, {
                    x: 0.75,
                    y: currentY,
                    w: 0.5,
                    h: 0.4,
                    fontSize: 14
                });
                const base64Svg = svgToBase64(opt.svg);
                if (base64Svg) slide.addImage({
                    data: base64Svg,
                    x: 1.25,
                    y: currentY - 0.15,
                    w: 0.8,
                    h: 0.8
                });
                currentY += 1.0;
            } else {
                slide.addText(optionText, {
                    x: 0.75,
                    y: currentY,
                    w: '85%',
                    h: 0.3,
                    fontSize: 14
                });
                currentY += 0.35;
            }
        }
    });
}



function createAnswerSlideWithDI(pptx, question, bgImagePath) {
    const slide = addSlideWithBackground(pptx, bgImagePath);
    
    slide.addText(`Answer & Solution: Q${question.questionNumber}`, { 
        x: 0.5, 
        y: 0.4, 
        w: '90%', 
        fontSize: 24, 
        bold: true, 
        color: '1A365D' 
    });

    // Add answer
    slide.addText(question.solution.answer, {
        x: 0.5, 
        y: 1.0, 
        w: '90%', 
        h: 0.4,
        fontSize: 18, 
        bold: true, 
        color: '008000',
    });
    
    let currentY = 1.6;
    const explanationText = question.solution.explanation.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    
    // Check for solution chart data
    if (question.solution.chartData) {
        // Add explanation text in smaller area
        slide.addText(explanationText, {
            x: 0.5, 
            y: currentY, 
            w: '45%', 
            h: 3.5, 
            fontSize: 12,
        });
        
        // Add solution chart
        createDIChart(slide, question.solution.chartData, {
            x: 5.5,
            y: currentY,
            w: 4,
            h: 3.5
        });
        
    } else if (question.solution.svg) {
        // Use SVG for non-DI solution diagrams
        slide.addText(explanationText, {
            x: 0.5, 
            y: currentY, 
            w: '50%', 
            h: 3.8, 
            fontSize: 12,
        });
        
        const base64Svg = svgToBase64(question.solution.svg);
        if (base64Svg) {
            slide.addImage({ 
                data: base64Svg, 
                x: 5.5, 
                y: 1.8, 
                w: 4, 
                h: 3,
            });
        }
    } else {
        // No chart/diagram in solution
        slide.addText(explanationText, {
            x: 0.5, 
            y: currentY, 
            w: '90%', 
            h: 3.8, 
            fontSize: 12,
        });
    }
}

async function generatePptFromJsonWithDI(jsonData, outputPath, backgroundPath) {
    try {
        console.log('📊 Creating PowerPoint presentation with DI chart support...');
        
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

        // Create question slides with DI support
        console.log('📝 Creating question slides with DI chart support...');
        allQuestions.forEach(q => createQuestionSlideWithDI(pptx, q, q.directions, backgroundPath));

        // Add answers divider slide
        const answerTitleSlide = addSlideWithBackground(pptx, backgroundPath);
        answerTitleSlide.addText('Answers & Solutions', { 
            x: 0, y: '45%', w: '100%', align: 'center', 
            fontSize: 44, color: '003B75', bold: true 
        });

        // Create answer slides with DI support
        console.log('✅ Creating answer slides with DI chart support...');
        allQuestions.forEach(q => createAnswerSlideWithDI(pptx, q, backgroundPath));

        // Save the presentation
        await pptx.writeFile({ fileName: outputPath });
        console.log(`📊 PowerPoint with DI charts generated successfully: ${path.basename(outputPath)}`);
        
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
