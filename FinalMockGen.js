import { GoogleGenerativeAI } from "@google/generative-ai";
import { program } from "commander";
import * as fs from "fs/promises";
import * as path from "path";
import puppeteer from "puppeteer";
import PptxGenJS from 'pptxgenjs';
import { Buffer } from 'buffer';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// --- SYSTEM PROMPTS FOR DIFFERENT EXAM TYPES ---
const EXAM_TYPE_PROMPTS = {
    'data-interpretation': `You are an expert exam designer and question creator specializing in DATA INTERPRETATION questions for competitive entrance exams. Your primary task is to generate a BRAND NEW, high-quality data interpretation mock test with charts, graphs, and analytical questions.

Follow these rules with absolute precision:

1. **Analyze Reference Materials:**
   * Carefully study all the provided "REFERENCE PYQ PDF" documents to understand question styles, common topics, difficulty level, and typical phrasing for data interpretation questions.
   * Examine the "REFERENCE Mock Test PDF" documents to understand their structure and the tone of their instructions.

2. **Generate Original Content:**
   * You MUST NOT copy any questions or passages directly from the reference materials.
   * All questions, options, solutions, and DATA CHARTS you generate must be entirely new and unique.
   * Focus on creating realistic business/academic datasets with meaningful relationships.

3. **Data Interpretation Requirements:**
   * Each question set should include ONE comprehensive chart/graph (pie chart, bar chart, line graph, table, etc.)
   * Generate 3-5 questions per chart that test different analytical skills:
     - Reading exact values from the chart
     - Calculating percentages and ratios
     - Finding trends and patterns
     - Making comparisons between data points
     - Drawing logical conclusions from data
   * Use realistic data themes: sales figures, demographics, survey results, academic performance, economic indicators, etc.
   * For Data Sufficiency questions, IT MUST HAVE STATEMENTS LIKE STATEMENT 1 AND STATEMENT 2 BEFORE QUESTIONS

4. **Chart/SVG Requirements:**
   * Create detailed, professional-looking charts using SVG
   * Include proper labels, legends, gridlines, and titles
   * Use distinct colors and clear formatting
   * Ensure all data is readable and mathematically consistent
   * Charts should contain 5-8 data points for optimal question variety`,

    'generic': `You are an expert exam designer and question creator for competitive entrance exams. Your primary task is to generate a BRAND NEW, high-quality mock test based on the exam type specified in the user's instructions.

Follow these rules with absolute precision:

1. **Analyze Reference Materials:**
   * Carefully study all the provided reference materials to understand question styles, common topics, difficulty level, and typical phrasing.
   * Examine the structure and tone of provided materials.

2. **Generate Original Content:**
   * You MUST NOT copy any questions or passages directly from the reference materials.
   * All questions, options, solutions, and any visual elements you generate must be entirely new and unique.
   * Create content appropriate to the specified exam type and subject matter.

3. **Adapt to Exam Type:**
   * For quantitative sections: Include mathematical problems, data analysis, and logical reasoning
   * For verbal sections: Include reading comprehension, grammar, vocabulary, and language skills
   * For logical reasoning: Include puzzles, patterns, and analytical thinking problems
   * For subject-specific exams: Focus on relevant domain knowledge and concepts`,

    'quantitative': `You are an expert quantitative aptitude question creator for competitive entrance exams. Generate original mathematical problems covering:

- Arithmetic (percentages, ratios, averages, profit & loss)
- Algebra (equations, inequalities, progressions)
- Geometry (areas, volumes, coordinate geometry)
- Data Interpretation (tables, charts, graphs)
- Number Systems and Modern Mathematics
- Time, Speed, Distance and Work problems

Ensure all mathematical calculations are correct and provide step-by-step solutions.`,

    'verbal': `You are an expert verbal aptitude question creator for competitive entrance exams. Generate original questions covering:

- Reading Comprehension (passages with multiple questions)
- English Grammar and Usage
- Vocabulary (synonyms, antonyms, analogies)
- Sentence Correction and Para Jumbles
- Critical Reasoning and Logical Deduction
- Fill in the blanks and Error Detection

Focus on testing language proficiency, comprehension, and analytical thinking.`
};

// --- ENHANCED JSON TO HTML CONVERSION ---
function convertJsonToHtml(jsonData, examType = 'generic') {
    const isDataInterpretation = examType === 'data-interpretation';
    
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${jsonData.examTitle || jsonData.title || 'Mock Test'}</title>
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
        
        .section-header {
            background: #f8f9fa;
            border: 2px solid #dee2e6;
            border-radius: 8px;
            padding: 15px 20px;
            margin: 25px 0 20px 0;
            text-align: center;
            page-break-after: avoid;
        }
        
        ${isDataInterpretation ? `
        .chart-container {
            background: #f7fafc;
            border: 2px solid #e2e8f0;
            border-radius: 12px;
            padding: 20px;
            margin: 20px 0;
            text-align: center;
            page-break-inside: avoid;
        }
        
        .chart-title {
            font-size: 18px;
            font-weight: 600;
            color: #2b6cb0;
            margin-bottom: 8px;
        }
        
        .chart-svg {
            display: flex;
            justify-content: center;
            margin: 16px 0;
        }
        
        .chart-svg svg {
            max-width: 100%;
            height: auto;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            background: white;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        ` : ''}
        
        .directions {
            background: #f0f9ff;
            border: 1px solid #bae6fd;
            border-radius: 6px;
            padding: 12px;
            margin: 16px 0;
            font-style: italic;
            color: #0c4a6e;
        }
        
        .question {
            background: #f7fafc;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 16px;
            margin: 12px 0;
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
        
        .answer-solutions {
            background: #f0fff4;
            border: 2px solid #38a169;
            border-radius: 8px;
            padding: 20px;
            margin: 32px 0;
            page-break-before: always;
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
        
        .answer-steps {
            color: #2f855a;
            font-size: 14px;
            line-height: 1.5;
        }
    </style>
</head>
<body>`;

    // Add header with proper data extraction
    const examDetails = jsonData.examDetails || {};
    const title = jsonData.examTitle || jsonData.title || 'Mock Test';
    const totalQuestions = examDetails.totalQuestions || jsonData.totalQuestions || 'N/A';
    const timeAllotted = examDetails.timeAllotted || jsonData.timeMinutes ? `${jsonData.timeMinutes} Minutes` : 'N/A';
    const maxMarks = examDetails.maxMarks || jsonData.maxMarks || 'N/A';

    html += `
    <div class="test-header">
        <h1>${title}</h1>
        <div class="test-info">
            <div class="test-info-item">
                <div class="test-info-label">Questions</div>
                <div class="test-info-value">${totalQuestions}</div>
            </div>
            <div class="test-info-item">
                <div class="test-info-label">Time</div>
                <div class="test-info-value">${timeAllotted}</div>
            </div>
            <div class="test-info-item">
                <div class="test-info-label">Marks</div>
                <div class="test-info-value">${maxMarks}</div>
            </div>
        </div>
    </div>`;

    // Add instructions
    const instructions = jsonData.instructions || {};
    if (instructions.points || instructions.title || jsonData.instructions) {
        const instructionPoints = instructions.points || jsonData.instructions || [];
        html += `
        <div class="instructions">
            <h2>${instructions.title || 'Instructions'}</h2>
            <ul>
                ${instructionPoints.map(point => `<li>${point}</li>`).join('')}
            </ul>
        </div>`;
    }

    // Process sections/questionSets
    const sections = jsonData.sections || [{ questionSets: jsonData.questionSets }];
    
    sections.forEach(section => {
        if (section.sectionTitle) {
            html += `
            <div class="section-header">
                <h2 class="section-title">${section.sectionTitle}</h2>
            </div>`;
        }
        
        const questionSets = section.questionSets || [];
        questionSets.forEach(questionSet => {
            // Add directions if present
            if (questionSet.directions) {
                const directionsTitle = questionSet.directions.title || questionSet.directions;
                const directionsText = questionSet.directions.text || '';
                html += `
                <div class="directions">
                    <div class="directions-title">${directionsTitle}</div>
                    ${directionsText ? `<div>${directionsText}</div>` : ''}
                </div>`;
            }
            
            // Add chart for data interpretation
            if (isDataInterpretation && questionSet.chartData) {
                html += `
                <div class="chart-container">
                    <div class="chart-title">${questionSet.chartData.title}</div>
                    ${questionSet.chartData.description ? `<div class="chart-description">${questionSet.chartData.description}</div>` : ''}
                    <div class="chart-svg">
                        ${questionSet.chartData.svg}
                    </div>
                </div>`;
            }
            
            // Add table for generic DI (backward compatibility)
            if (questionSet.dataType === 'table' && questionSet.tableHeaders && questionSet.tableRows) {
                html += createTableHtml(questionSet);
            }
            
            // Add questions
            const questions = questionSet.questions || [];
            questions.forEach(question => {
                html += `
                <div class="question">
                    <span class="question-number">${question.questionNumber || question.qNum}.</span>
                    <div class="question-text">${question.questionText || question.question}</div>
                    
                    <div class="options">
                        ${formatQuestionOptions(question)}
                    </div>
                </div>`;
            });
        });
    });

    // Add answers section
    html += `
    <div class="answer-solutions">
        <h2>Answer Key & Solutions</h2>`;
        
    sections.forEach(section => {
        const questionSets = section.questionSets || [];
        questionSets.forEach(questionSet => {
            const questions = questionSet.questions || [];
            questions.forEach(question => {
                const solution = question.solution || { answer: question.answer, steps: question.explanation ? [question.explanation] : [] };
                html += `
                <div class="answer-item">
                    <div class="answer-key">${question.questionNumber || question.qNum}: ${solution.answer}</div>
                    <div class="answer-steps">
                        ${solution.steps ? `<ol>${solution.steps.map(step => `<li>${step}</li>`).join('')}</ol>` : ''}
                    </div>
                </div>`;
            });
        });
    });

    html += `
        </div>
    </body>
    </html>`;

    return html;
}

function formatQuestionOptions(question) {
    let optionsHtml = '';
    
    // Handle new format (options array)
    if (question.options && Array.isArray(question.options)) {
        question.options.forEach(option => {
            optionsHtml += `
                <div class="option">
                    <strong>${option.label})</strong> ${option.text}
                </div>`;
        });
    }
    // Handle legacy format (optA, optB, etc.)
    else {
        ['A', 'B', 'C', 'D', 'E'].forEach(letter => {
            const optionKey = `opt${letter}`;
            if (question[optionKey]) {
                optionsHtml += `
                    <div class="option">
                        <strong>${letter})</strong> ${question[optionKey]}
                    </div>`;
            }
        });
    }
    
    return optionsHtml;
}

function createTableHtml(questionSet) {
    const headers = questionSet.tableHeaders || [];
    const rows = questionSet.tableRows || [];
    
    return `
    <div class="chart-container">
        ${questionSet.dataTitle ? `<div class="chart-title">${questionSet.dataTitle}</div>` : ''}
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
            <thead>
                <tr style="background: #e2e8f0;">
                    ${headers.map(header => `<th style="border: 1px solid #cbd5e0; padding: 8px; font-weight: 600;">${header}</th>`).join('')}
                </tr>
            </thead>
            <tbody>
                ${rows.map(row => `
                    <tr>
                        ${Array.isArray(row) ? row.map(cell => `<td style="border: 1px solid #cbd5e0; padding: 8px; text-align: center;">${cell}</td>`).join('') : `<td colspan="${headers.length}" style="border: 1px solid #cbd5e0; padding: 8px;">${row}</td>`}
                    </tr>
                `).join('')}
            </tbody>
        </table>
    </div>`;
}

// --- ENHANCED POWERPOINT FUNCTIONS ---
function createChartSlide(pptx, questionSet, bgImagePath) {
    const slide = addSlideWithBackground(pptx, bgImagePath);

    // Add directions at the top if available
    if (questionSet.directions) {
        const directionsTitle = questionSet.directions.title || questionSet.directions;
        const directionsText = questionSet.directions.text || '';
        
        slide.addText(directionsTitle, {
            x: 0.5, y: 0.25, w: '90%', h: 0.4,
            fontSize: 16, fontFace: 'Calibri',
            bold: true, color: '003B75'
        });
        
        if (directionsText) {
            slide.addText(directionsText, {
                x: 0.5, y: 0.7, w: '90%', h: 0.5,
                fontSize: 12, fontFace: 'Calibri',
                color: '333333'
            });
        }
    }

    // Add chart/data visualization
    if (questionSet.chartData) {
        // For new Data Interpretation format with SVG charts
        slide.addText(questionSet.chartData.title, {
            x: 0.5, y: 1.3, w: '90%', h: 0.5,
            fontSize: 20, fontFace: 'Calibri',
            bold: true, color: '003B75', align: 'center'
        });

        const base64Svg = svgToBase64(questionSet.chartData.svg);
        if (base64Svg) {
            const scale = 0.95;
            const origW = 5.0;
            const origH = 3.0;
            const newW = origW * scale;
            const newH = origH * scale;
            const slideW = 10;
            const posX = (slideW - newW) / 2;
            const posY = 2.0;

            slide.addImage({
                data: base64Svg,
                x: posX, y: posY,
                w: newW, h: newH,
                sizing: { type: 'contain', w: newW, h: newH }
            });
        }
    } else if (questionSet.dataType === 'table' && questionSet.tableHeaders && questionSet.tableRows) {
        // For legacy table format
        createTableSlide(slide, questionSet);
    }
}

function createTableSlide(slide, questionSet) {
    if (questionSet.dataTitle) {
        slide.addText(questionSet.dataTitle, {
            x: 0.5, y: 1.3, w: '90%', h: 0.5,
            fontSize: 20, fontFace: 'Calibri',
            bold: true, color: '003B75', align: 'center'
        });
    }

    const tableRows = [
        questionSet.tableHeaders.map(header => String(header || '')),
        ...questionSet.tableRows.map(row => 
            Array.isArray(row) ? 
            row.map(cell => String(cell || '')) : 
            [String(row || '')]
        )
    ];

    slide.addTable(tableRows, {
        x: 0.5, y: 1.8, w: 9, h: 3,
        border: { type: "solid", pt: 1, color: "1A365D" },
        fill: { color: "F8FAFC" },
        color: "1E293B",
        fontSize: 11,
        align: "center",
        valign: "middle"
    });
}

function createQuestionSlide(pptx, question, bgImagePath) {
    const slide = addSlideWithBackground(pptx, bgImagePath);

    const questionNumber = question.questionNumber || question.qNum;
    const questionText = question.questionText || question.question;

    // Question number
    slide.addText(`Question ${questionNumber}`, {
        x: 0.5, y: 0.5, w: '90%', h: 0.6,
        fontSize: 24, fontFace: 'Calibri',
        bold: true, color: '003B75'
    });

    // Question text
    slide.addText(questionText, {
        x: 0.5, y: 1.2, w: '90%', h: 1.0,
        fontSize: 16, fontFace: 'Calibri',
        wrap: true
    });

    // Options
    let optionY = 2.4;
    
    // Handle both new and legacy option formats
    if (question.options && Array.isArray(question.options)) {
        question.options.forEach(option => {
            slide.addText(`${option.label}) ${option.text}`, {
                x: 0.75, y: optionY, w: '80%', h: 0.4,
                fontSize: 14, fontFace: 'Calibri',
                valign: 'top', wrap: true
            });
            optionY += 0.5;
        });
    } else {
        ['A', 'B', 'C', 'D', 'E'].forEach(letter => {
            const optionKey = `opt${letter}`;
            if (question[optionKey]) {
                slide.addText(`${letter}) ${question[optionKey]}`, {
                    x: 0.75, y: optionY, w: '80%', h: 0.4,
                    fontSize: 14, fontFace: 'Calibri',
                    valign: 'top', wrap: true
                });
                optionY += 0.5;
            }
        });
    }
}

function createAnswerSlide(pptx, question, bgImagePath) {
    const slide = addSlideWithBackground(pptx, bgImagePath);

    const questionNumber = question.questionNumber || question.qNum;
    const solution = question.solution || { 
        answer: question.answer, 
        steps: question.explanation ? [question.explanation] : [] 
    };

    // Answer title
    slide.addText(`Solution for Question ${questionNumber}`, {
        x: 0.5, y: 0.5, w: '90%', h: 0.5,
        fontSize: 24, fontFace: 'Calibri',
        bold: true, color: '003B75'
    });

    // Correct Answer
    slide.addText(`Correct Answer: ${solution.answer}`, {
        x: 0.5, y: 1.5, w: '90%', h: 0.4,
        fontSize: 18, fontFace: 'Calibri',
        bold: true, color: '008000'
    });

    // Steps
    if (solution.steps && solution.steps.length > 0) {
        slide.addText("Step-by-step solution:", {
            x: 0.5, y: 2.2, w: '90%', h: 0.4,
            fontSize: 16, fontFace: 'Calibri',
            bold: true
        });

        const stepsText = solution.steps.map((step, index) => `${index + 1}. ${step}`).join('\n');
        slide.addText(stepsText, {
            x: 0.75, y: 2.8, w: '85%', h: 3.5,
            fontSize: 14, fontFace: 'Calibri',
            wrap: true
        });
    }
}

function svgToBase64(svgContent) {
    if (!svgContent || !svgContent.includes('<svg')) return null;
    
    const svgMatch = svgContent.match(/<svg[^>]*>[\s\S]*?<\/svg>/i);
    if (!svgMatch) return null;

    let svgString = svgMatch[0];

    if (!svgString.includes('viewBox=')) {
        svgString = svgString.replace('<svg', '<svg viewBox="0 0 800 600"');
    }

    svgString = svgString.replace(/<svg([^>]*)>/i, (match, attributes) => {
        let newAttributes = attributes;
        if (!attributes.includes('width=')) {
            newAttributes += ' width="800"';
        }
        if (!attributes.includes('height=')) {
            newAttributes += ' height="600"';
        }
        return `<svg${newAttributes}>`;
    });

    return `data:image/svg+xml;base64,${Buffer.from(svgString).toString('base64')}`;
}

function addSlideWithBackground(pptx, backgroundPath) {
    const slide = pptx.addSlide();
    if (backgroundPath) {
        try {
            slide.background = { path: backgroundPath };
        } catch (error) {
            console.warn(`Failed to set background image: ${error.message}`);
        }
    }
    return slide;
}

function createTitleSlide(pptx, data, bgImagePath) {
    const slide = addSlideWithBackground(pptx, bgImagePath);
    const title = data.examTitle || data.title || 'Mock Test';
    
    slide.addText(title, {
        x: 0.5, y: 1.5, w: '90%', h: 1, 
        fontSize: 40, bold: true, color: '003B75', align: 'center'
    });
    
    const details = data.examDetails || {};
    const totalQuestions = details.totalQuestions || data.totalQuestions || 'N/A';
    const timeAllotted = details.timeAllotted || (data.timeMinutes ? `${data.timeMinutes} Minutes` : 'N/A');
    const maxMarks = details.maxMarks || data.maxMarks || 'N/A';
    
    const detailsText = `Total Questions: ${totalQuestions}  |  Time Allotted: ${timeAllotted}  |  Max Marks: ${maxMarks}`;
    slide.addText(detailsText, {
        x: 0.5, y: 3.0, w: '90%', h: 0.5, 
        fontSize: 20, color: '333333', align: 'center'
    });
}

function createInstructionsSlide(pptx, data, bgImagePath) {
    const slide = addSlideWithBackground(pptx, bgImagePath);
    const instructions = data.instructions || {};
    const instructionTitle = instructions.title || 'Instructions';
    const instructionPoints = instructions.points || data.instructions || [];
    
    slide.addText(instructionTitle, { 
        x: 0.5, y: 0.5, w: '90%', 
        fontSize: 32, bold: true, color: '2B6CB0' 
    });
    
    const formattedInstructions = instructionPoints.map(point => ({
        text: point,
        options: { fontSize: 18, bullet: true, paraSpcAfter: 10 }
    }));
    
    slide.addText(formattedInstructions, {
        x: 0.75, y: 1.5, w: '85%', h: 3.5
    });
}

// --- MAIN PPT GENERATION FUNCTION ---
async function generatePptFromJson(jsonData, outputPath, backgroundPath, examType = 'generic') {
    try {
        console.log(`Creating PowerPoint presentation for ${examType}...`);

        const pptx = new PptxGenJS();
        const isDataInterpretation = examType === 'data-interpretation';

        // Create title and instructions slides
        createTitleSlide(pptx, jsonData, backgroundPath);
        createInstructionsSlide(pptx, jsonData, backgroundPath);

        // Process sections
        const sections = jsonData.sections || [{ questionSets: jsonData.questionSets }];
        
        sections.forEach((section, sectionIndex) => {
            const questionSets = section.questionSets || [];
            
            questionSets.forEach((questionSet, setIndex) => {
                // Create chart/data slide for data interpretation or tables
                if (isDataInterpretation || questionSet.dataType === 'table' || questionSet.chartData) {
                    console.log(`Creating chart slide for section ${sectionIndex + 1}, set ${setIndex + 1}...`);
                    createChartSlide(pptx, questionSet, backgroundPath);
                }

                // Create question slides
                const questions = questionSet.questions || [];
                questions.forEach(question => {
                    const questionNumber = question.questionNumber || question.qNum;
                    console.log(`Creating slide for question ${questionNumber}...`);
                    createQuestionSlide(pptx, question, backgroundPath);
                });
            });
        });

        // Add answers divider slide
        const answerTitleSlide = addSlideWithBackground(pptx, backgroundPath);
        answerTitleSlide.addText('Answers & Solutions', {
            x: 0, y: '45%', w: '100%', align: 'center',
            fontSize: 44, color: '003B75', bold: true
        });

        // Create answer slides
        sections.forEach(section => {
            const questionSets = section.questionSets || [];
            questionSets.forEach(questionSet => {
                const questions = questionSet.questions || [];
                questions.forEach(question => {
                    const questionNumber = question.questionNumber || question.qNum;
                    console.log(`Creating answer slide for question ${questionNumber}...`);
                    createAnswerSlide(pptx, question, backgroundPath);
                });
            });
        });

        // Save the presentation
        await pptx.writeFile({ fileName: outputPath });
        console.log(`PowerPoint generated successfully: ${path.basename(outputPath)}`);

        // Optional: Convert to .ppt format (requires LibreOffice)
        if (process.platform === 'darwin') { // macOS
            try {
                const outDir = path.dirname(outputPath);
                const command = `/Applications/LibreOffice.app/Contents/MacOS/soffice --headless --convert-to ppt "${outputPath}" --outdir "${outDir}"`;
                console.log(`Converting to .ppt format...`);
                await execAsync(command);
                console.log(`Conversion to .ppt completed.`);
            } catch (error) {
                console.warn(`PPT conversion failed (LibreOffice not available): ${error.message}`);
            }
        }

    } catch (error) {
        console.error(`PowerPoint generation failed: ${error.message}`);
        throw error;
    }
}

// --- PDF GENERATION FROM HTML ---
async function generatePdf(htmlContent, outputPath) {
    let browser = null;
    try {
        console.log('Launching browser for PDF generation...');
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
        console.log(`PDF generated successfully: ${path.basename(outputPath)}`);
        
    } catch (error) {
        console.error('PDF generation failed:', error.message);
        throw error;
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

// --- ENHANCED API KEY MANAGER ---
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
        
        console.log(`Loaded ${this.apiKeys.length} API keys for parallel usage`);
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
            console.log(`Reassigning key for mock ${mockNumber} (previous key failed)`);
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
        console.warn(`API key ${keyIndex + 1} marked as failed: ${error.message}`);
        
        if (this.failedKeys.size < this.apiKeys.length) {
            console.log(`${this.apiKeys.length - this.failedKeys.size} API keys remaining`);
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

    getStats() {
        return {
            total: this.apiKeys.length,
            available: this.apiKeys.length - this.failedKeys.size,
            failed: this.failedKeys.size,
            usage: Object.fromEntries(this.keyUsageCount)
        };
    }
}

let apiKeyManager = null;

// --- HELPER FUNCTIONS ---
function validateThinkingBudget(budget, model) {
    if (budget === undefined) return null;
    
    const budgetNum = parseInt(budget);
    
    if (budgetNum === -1) return -1;
    
    if (budgetNum === 0) {
        if (model.includes('pro')) {
            console.warn("Warning: Thinking cannot be disabled for Gemini Pro models. Using minimum budget (128) instead.");
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
    
    if (options.temperature && options.temperature !== 0.7) {
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
        console.log(`Thinking budget: ${budgetDesc}`);
    }
    
    return config;
}

function detectExamType(userPrompt) {
    const prompt = userPrompt.toLowerCase();
    
    if (prompt.includes('data interpretation') || prompt.includes('charts') || prompt.includes('graphs') || prompt.includes('tables')) {
        return 'data-interpretation';
    } else if (prompt.includes('quantitative') || prompt.includes('mathematics') || prompt.includes('arithmetic')) {
        return 'quantitative';
    } else if (prompt.includes('verbal') || prompt.includes('english') || prompt.includes('reading comprehension')) {
        return 'verbal';
    }
    
    return 'generic';
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
        console.warn(`Warning: Could not get file size for ${filePath}`);
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
                console.warn(`  - Warning: File ${path.basename(filePath)} is ${(fileSize / 1024 / 1024).toFixed(2)}MB, which exceeds the 20MB limit. Skipping.`);
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
            console.error(`  - Warning: Could not read file ${filePath}. Error: ${error.message}. Skipping.`);
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

function generateDebugFilename(baseOutput, mockNumber, totalMocks, extension) {
    const baseName = path.basename(baseOutput, path.extname(baseOutput));
    const dir = path.dirname(baseOutput);

    if (totalMocks === 1) {
        return path.join(dir, `${baseName}_debug${extension}`);
    }

    const paddedNumber = String(mockNumber).padStart(String(totalMocks).length, '0');
    return path.join(dir, `${baseName}_${paddedNumber}_debug${extension}`);
}

// --- ENHANCED JSON PARSING WITH RECOVERY ---
function parseJsonResponse(responseText, examType = 'generic') {
    if (!responseText || typeof responseText !== 'string') {
        throw new Error("Empty response from API");
    }

    console.log(`Raw response length: ${responseText.length} characters`);

    let json = responseText.trim();
    
    // Remove markdown code blocks
    if (json.startsWith('```')) {
        json = json.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '');
    }
    
    // Basic cleanup
    json = json
        .replace(/[\u0000-\u001F\u007F]/g, '') // Control characters
        .replace(/,(\s*[}\]])/g, '$1') // Trailing commas
        .replace(/\r\n/g, ' ') // Windows line endings
        .replace(/\n/g, ' ') // Unix line endings
        .replace(/\r/g, ' ') // Mac line endings
        .replace(/\t/g, ' ') // Tabs
        .replace(/\s+/g, ' ') // Multiple spaces
        .trim();

    try {
        const data = JSON.parse(json);
        
        // Validate structure based on exam type
        if (examType === 'data-interpretation') {
            if (!data.sections && !data.questionSets) {
                throw new Error("Missing sections or questionSets for data interpretation");
            }
        } else {
            // For legacy format compatibility
            if (!data.title && !data.examTitle) data.title = "Mock Test";
            if (!data.totalQuestions) data.totalQuestions = 25;
            if (!data.timeMinutes) data.timeMinutes = 60;
            if (!data.maxMarks) data.maxMarks = 100;
        }
        
        return data;
        
    } catch (error) {
        console.error(`JSON parsing failed: ${error.message}`);
        console.error("Response preview:", json.substring(0, 500) + "...");
        throw error;
    }
}

// --- MAIN MOCK GENERATION FUNCTION ---
async function generateSingleMock(contents, outputPath, mockNumber, totalMocks, options) {
    const maxRetries = 3;
    let lastError = null;
    let currentKeyInfo = null;

    try {
        currentKeyInfo = apiKeyManager.assignKeyToMock(mockNumber);
        console.log(`Mock ${mockNumber}/${totalMocks} assigned to API Key ${currentKeyInfo.index + 1}`);
    } catch (error) {
        console.error(`Could not assign API key to mock ${mockNumber}: ${error.message}`);
        return { success: false, error: error, outputPath: outputPath };
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            currentKeyInfo = apiKeyManager.getKeyForMock(mockNumber);
            const genAI = new GoogleGenerativeAI(currentKeyInfo.key);
            
            console.log(`Mock ${mockNumber}/${totalMocks} - Attempt ${attempt}/${maxRetries} (API Key ${currentKeyInfo.index + 1})`);
            
            const generationConfig = createGenerationConfig(options, options.model);
            const model = genAI.getGenerativeModel({ 
                model: options.model,
                generationConfig
            });
            
            if (options.rateLimitDelay && options.rateLimitDelay > 0) {
                const adjustedDelay = Math.max(100, options.rateLimitDelay / apiKeyManager.apiKeys.length);
                await new Promise(resolve => setTimeout(resolve, adjustedDelay));
            }
            
            const result = await model.generateContent(contents);
            const response = await result.response;
            const generatedJson = response.text();
            
            if (!generatedJson || generatedJson.trim().length === 0) {
                throw new Error("Empty response received from API");
            }

            // Log token usage if available
            if (result.response.usageMetadata) {
                const usage = result.response.usageMetadata;
                console.log(`Token usage (Key ${currentKeyInfo.index + 1}) - Input: ${usage.promptTokenCount || 'N/A'}, Output: ${usage.candidatesTokenCount || 'N/A'}`);
            }

            // Parse and validate JSON
            const examType = detectExamType(contents.find(c => c.text && c.text.includes('USER INSTRUCTIONS'))?.text || '');
            const jsonData = parseJsonResponse(generatedJson, examType);

            // Ensure output directory exists
            const outputDir = path.dirname(outputPath);
            if (outputDir !== '.') {
                await fs.mkdir(outputDir, { recursive: true });
            }

            // Save debug files if requested
            if (options.saveJson) {
                const debugJsonPath = generateDebugFilename(options.output, mockNumber, totalMocks, '.json');
                try {
                    await fs.writeFile(debugJsonPath, JSON.stringify(jsonData, null, 2));
                    console.log(`[DEBUG] Raw JSON saved: ${path.basename(debugJsonPath)}`);
                } catch(e) {
                    console.error(`[DEBUG] Failed to save JSON: ${e.message}`);
                }
            }

            // Generate HTML and PDF
            console.log(`Converting JSON to HTML for mock ${mockNumber}...`);
            const htmlContent = convertJsonToHtml(jsonData, examType);

            if (options.saveHtml) {
                const debugHtmlPath = generateDebugFilename(options.output, mockNumber, totalMocks, '.html');
                try {
                    await fs.writeFile(debugHtmlPath, htmlContent);
                    console.log(`[DEBUG] HTML saved: ${path.basename(debugHtmlPath)}`);
                } catch(e) {
                    console.error(`[DEBUG] Failed to save HTML: ${e.message}`);
                }
            }

            console.log(`Converting to PDF: ${path.basename(outputPath)}`);
            await generatePdf(htmlContent, outputPath);

            // Generate PowerPoint if requested
            if (options.ppt) {
                const pptOutputPath = generateOutputFilename(options.output, mockNumber, totalMocks, '.pptx');
                const backgroundPath = options.pptBackground || null;
                await generatePptFromJson(jsonData, pptOutputPath, backgroundPath, examType);
            }
            
            apiKeyManager.incrementUsage(currentKeyInfo.index);
            
            console.log(`Mock ${mockNumber}/${totalMocks} completed with API Key ${currentKeyInfo.index + 1}: ${path.basename(outputPath)}`);
            
            return {
                success: true,
                outputPath: outputPath,
                contentLength: generatedJson.length,
                keyIndex: currentKeyInfo.index,
                usage: result.response.usageMetadata,
                mockNumber: mockNumber,
                jsonData: jsonData,
                examType: examType
            };

        } catch (error) {
            lastError = error;
            const isQuotaError = error.message.includes('quota') || 
                               error.message.includes('RESOURCE_EXHAUSTED') ||
                               error.message.includes('rate limit');
            
            if (isQuotaError && currentKeyInfo) {
                apiKeyManager.markKeyAsFailed(currentKeyInfo.index, error);
                
                try {
                    currentKeyInfo = apiKeyManager.getNextAvailableKey(currentKeyInfo.index);
                    apiKeyManager.keyAssignments.set(mockNumber, currentKeyInfo.index);
                    console.log(`Mock ${mockNumber} switched to API Key ${currentKeyInfo.index + 1} for retry`);
                    continue;
                } catch (keyError) {
                    console.error(`No alternative API keys available for mock ${mockNumber}`);
                    break;
                }
            }
            
            if (attempt === maxRetries) {
                console.error(`Mock ${mockNumber}/${totalMocks} failed after ${maxRetries} attempts`);
                break;
            }
            
            const waitTime = Math.pow(1.5, attempt - 1) * 1000;
            console.log(`Waiting ${waitTime}ms before retry...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
    }

    return { success: false, error: lastError, outputPath: outputPath };
}

// --- MAIN EXECUTION LOGIC ---
async function main() {
    program
        .name('enhanced-mock-generator')
        .description('Generate mock tests from PDFs with support for multiple exam types')
        .version('3.0.0')
        .requiredOption("--pyq <dir>", "Directory containing previous year question PDFs")
        .requiredOption("--reference-mock <dir>", "Directory containing reference mock PDFs")
        .requiredOption("-o, --output <filename>", "Base output filename for generated files")
        .requiredOption("--prompt <file>", "Path to user prompt file containing specific instructions")
        .option("--api-key-file <file>", "Path to API key file (default: api_key.txt)", "api_key.txt")
        .option("--number-of-mocks <number>", "Number of mock tests to generate (default: 1)", parseInt, 1)
        .option("--max-tokens <number>", "Maximum output tokens per request (default: 8192)", parseInt, 8192)
        .option("--temperature <number>", "Temperature for response generation (0.0-2.0, default: 0.7)", parseFloat, 0.7)
        .option("--concurrent-limit <number>", "Maximum concurrent API requests (default: 3)", parseInt, 3)
        .option("--rate-limit-delay <number>", "Delay between API requests in ms (default: 1000)", parseInt, 1000)
        .option("--thinking-budget <number>", "Thinking budget tokens for internal reasoning")
        .option("--model <model>", "Gemini model to use (default: gemini-2.0-flash-exp)", "gemini-2.0-flash-exp")
        .option("--exam-type <type>", "Exam type: data-interpretation, quantitative, verbal, generic (auto-detect if not specified)")
        .option("--ppt", "Generate PowerPoint (.pptx) files")
        .option("--ppt-background <file>", "Background image file for PowerPoint slides")
        .option("--save-json", "Save the raw generated JSON to debug files")
        .option("--save-html", "Save the generated HTML to debug files")
        .parse(process.argv);

    const options = program.opts();
    const numberOfMocks = options.numberOfMocks || 1;
    const maxConcurrent = options.concurrentLimit || 3;

    if (!numberOfMocks || isNaN(numberOfMocks) || numberOfMocks < 1) {
        console.error(`Error: --number-of-mocks must be a positive integer, got: ${numberOfMocks}`);
        process.exit(1);
    }

    // Check for required dependencies
    try {
        await import('puppeteer');
        console.log('Puppeteer available - PDF generation enabled.');
    } catch (error) {
        console.error('Puppeteer is required but not installed. Please install: npm install puppeteer');
        process.exit(1);
    }

    if (options.ppt) {
        try {
            await import('pptxgenjs');
            console.log('PptxGenJS available - PowerPoint generation enabled.');
        } catch (error) {
            console.error('PptxGenJS is required for PowerPoint generation. Please install: npm install pptxgenjs');
            process.exit(1);
        }
    }

    try {
        console.log("Enhanced Mock Test Generator v3.0.0");
        console.log("=====================================");

        // 1. Validate directories
        console.log("Validating directories...");
        await validateDirectories(options.pyq, options.referenceMock);

        // 2. Setup API Key Manager
        console.log(`Reading API keys from: ${options.apiKeyFile}`);
        let apiKeys = [];
        try {
            const apiKeyContent = await fs.readFile(options.apiKeyFile, "utf-8");
            apiKeys = apiKeyContent.split('\n').map(key => key.trim()).filter(key => key.length > 0);
            apiKeys = apiKeys.map(validateApiKey);
            
            if (apiKeys.length === 0) {
                throw new Error("No valid API keys found");
            }
        } catch (error) {
            if (error.code === 'ENOENT') {
                console.error(`\nError: '${options.apiKeyFile}' not found. Please create this file with your API key(s).`);
            } else {
                console.error(`\nError reading API keys: ${error.message}`);
            }
            process.exit(1);
        }

        apiKeyManager = new ApiKeyManager(apiKeys);

        // 3. Read user prompt
        let userPrompt = "";
        try {
            userPrompt = await fs.readFile(options.prompt, "utf-8");
            console.log(`Using prompt from: ${options.prompt}`);
        } catch (error) {
            console.error(`\nError reading prompt file '${options.prompt}': ${error.message}`);
            process.exit(1);
        }

        if (!userPrompt.trim()) {
            console.error("Error: Prompt file is empty.");
            process.exit(1);
        }

        // 4. Detect exam type
        const examType = options.examType || detectExamType(userPrompt);
        const systemPrompt = EXAM_TYPE_PROMPTS[examType] || EXAM_TYPE_PROMPTS['generic'];
        
        console.log(`Detected exam type: ${examType}`);

        // 5. Process PDF files
        console.log("\nProcessing input files...");
        const pyqFiles = await findPdfFiles(options.pyq);
        const refMockFiles = await findPdfFiles(options.referenceMock);

        console.log(`Found ${pyqFiles.length} PYQ PDF files`);
        console.log(`Found ${refMockFiles.length} reference mock PDF files`);

        if (pyqFiles.length === 0 && refMockFiles.length === 0) {
            console.error("\nError: No PDF files found in the provided directories.");
            process.exit(1);
        }

        const pyqParts = await filesToGenerativeParts(pyqFiles, "PYQ");
        const refMockParts = await filesToGenerativeParts(refMockFiles, "Reference Mock");

        if (pyqParts.length === 0 && refMockParts.length === 0) {
            console.error("\nError: No valid PDF files could be processed.");
            process.exit(1);
        }

        // 6. Construct API request content
        const contents = [
            { text: systemPrompt },
            { text: "--- REFERENCE PYQ PDFS ---" },
            ...pyqParts,
            { text: "--- REFERENCE MOCK TEST PDFS ---" },
            ...refMockParts,
            { text: "--- USER INSTRUCTIONS ---" },
            { text: userPrompt }
        ];

        // Add JSON format specification based on exam type
        if (examType === 'data-interpretation') {
            contents.push({
                text: `
5. **Format as a Single, Complete JSON Object:**
   The ENTIRE output MUST be a single JSON object with this schema:
   {
     "examTitle": "String",
     "examDetails": {
       "totalQuestions": Number,
       "timeAllotted": "String",
       "maxMarks": Number
     },
     "instructions": {
       "title": "String",
       "points": ["String", ...]
     },
     "sections": [
       {
         "sectionTitle": "String",
         "questionSets": [
           {
             "type": "group",
             "directions": {
               "title": "String",
               "text": "String"
             },
             "chartData": {
               "title": "String",
               "description": "String",
               "svg": "String"
             },
             "questions": [
               {
                 "questionNumber": "String",
                 "questionText": "String",
                 "options": [
                   {
                     "label": "String",
                     "text": "String"
                   }
                 ],
                 "solution": {
                   "answer": "String",
                   "steps": ["String", ...]
                 }
               }
             ]
           }
         ]
       }
     ]
   }`
            });
        }

        // 7. Generate mock tests
        console.log(`\nStarting generation of ${numberOfMocks} mock test(s)...`);
        let outputFormats = ["JSON", "PDF"];
        if (options.ppt) outputFormats.push("PowerPoint");
        console.log(`Output Formats: ${outputFormats.join(', ')}`);
        console.log(`Exam Type: ${examType}`);
        
        if (options.saveJson) console.log("Debug JSON files will be saved.");
        if (options.saveHtml) console.log("Debug HTML files will be saved.");
        
        const startTime = Date.now();
        
        // Create generation tasks
        const generationTasks = [];
        for (let i = 1; i <= numberOfMocks; i++) {
            const outputPath = generateOutputFilename(options.output, i, numberOfMocks, '.pdf');
            generationTasks.push(() => generateSingleMock(contents, outputPath, i, numberOfMocks, options));
        }

        // Execute tasks with concurrency control
        const results = [];
        for (let i = 0; i < generationTasks.length; i += maxConcurrent) {
            const batch = generationTasks.slice(i, i + maxConcurrent).map(task => task());
            const batchResults = await Promise.allSettled(batch);
            results.push(...batchResults);
            
            // Small delay between batches to avoid overwhelming APIs
            if (i + maxConcurrent < generationTasks.length) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }
        
        const endTime = Date.now();
        const totalTime = (endTime - startTime) / 1000;

        // Process results
        const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).map(r => r.value);
        const failed = results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success));

        // Display comprehensive summary
        console.log(`\n${'='.repeat(50)}`);
        console.log(`Mock Test Generation Summary (${examType})`);
        console.log(`${'='.repeat(50)}`);
        console.log(`Total requested: ${numberOfMocks}`);
        console.log(`Successful: ${successful.length}`);
        console.log(`Failed: ${failed.length}`);
        console.log(`Total time: ${totalTime.toFixed(2)} seconds`);
        console.log(`Average time per mock: ${(totalTime / numberOfMocks).toFixed(2)} seconds`);
        
        // API usage statistics
        const stats = apiKeyManager.getStats();
        console.log(`\nAPI Usage Statistics:`);
        console.log(`  Total keys: ${stats.total}`);
        console.log(`  Available: ${stats.available}`);
        console.log(`  Failed: ${stats.failed}`);
        if (Object.keys(stats.usage).length > 0) {
            console.log(`  Usage distribution:`, stats.usage);
        }
        
        if (successful.length > 0) {
            console.log(`\n${'Generated Files:'.padEnd(20, ' ')}`);
            successful.sort((a, b) => a.mockNumber - b.mockNumber).forEach(result => {
                console.log(`  Mock ${result.mockNumber.toString().padStart(2, '0')}: ${path.basename(result.outputPath)} (${(result.contentLength / 1024).toFixed(1)}KB, Key ${result.keyIndex + 1})`);
                
                if (options.ppt) {
                    const pptPath = generateOutputFilename(options.output, result.mockNumber, numberOfMocks, '.pptx');
                    console.log(`           PowerPoint: ${path.basename(pptPath)}`);
                }
                
                if (options.saveJson) {
                    const jsonPath = generateDebugFilename(options.output, result.mockNumber, numberOfMocks, '.json');
                    console.log(`           Debug JSON: ${path.basename(jsonPath)}`);
                }
                
                if (options.saveHtml) {
                    const htmlPath = generateDebugFilename(options.output, result.mockNumber, numberOfMocks, '.html');
                    console.log(`           Debug HTML: ${path.basename(htmlPath)}`);
                }
            });
            
            // Show exam type specific features
            if (examType === 'data-interpretation') {
                console.log(`\nData Interpretation Features:`);
                console.log(`  - Dedicated chart slides in PowerPoint`);
                console.log(`  - Comprehensive SVG charts (pie, bar, line, tables)`);
                console.log(`  - Mathematical step-by-step solutions`);
                console.log(`  - Single direction box per question set`);
                console.log(`  - Optimized layout for chart visibility`);
            }
            
            // Token usage summary
            const totalInputTokens = successful.reduce((sum, r) => sum + (r.usage?.promptTokenCount || 0), 0);
            const totalOutputTokens = successful.reduce((sum, r) => sum + (r.usage?.candidatesTokenCount || 0), 0);
            if (totalInputTokens > 0 || totalOutputTokens > 0) {
                console.log(`\nToken Usage Summary:`);
                console.log(`  Input tokens: ${totalInputTokens.toLocaleString()}`);
                console.log(`  Output tokens: ${totalOutputTokens.toLocaleString()}`);
                console.log(`  Total tokens: ${(totalInputTokens + totalOutputTokens).toLocaleString()}`);
            }
        }

        if (failed.length > 0) {
            console.log(`\n${'Failed Generations:'.padEnd(20, ' ')}`);
            failed.forEach((result, index) => {
                const error = result.reason || result.value?.error;
                const mockNumber = result.value?.mockNumber || (index + successful.length + 1);
                console.log(`  Mock ${mockNumber.toString().padStart(2, '0')}: ${error?.message || 'Unknown error'}`);
            });
            
            console.log(`\nCommon solutions for failures:`);
            console.log(`  - Check API key quotas and limits`);
            console.log(`  - Reduce --max-tokens if responses are being truncated`);
            console.log(`  - Increase --rate-limit-delay for rate limit errors`);
            console.log(`  - Verify PDF files are valid and under 20MB each`);
        }

        if (successful.length === 0) {
            console.error(`\nAll mock test generations failed!`);
            console.error(`Please check the errors above and try again.`);
            process.exit(1);
        }

        const successRate = (successful.length / numberOfMocks * 100).toFixed(1);
        console.log(`\n${'='.repeat(50)}`);
        console.log(`Success Rate: ${successRate}% (${successful.length}/${numberOfMocks})`);
        
        if (successful.length === numberOfMocks) {
            console.log(`All mock tests generated successfully!`);
        } else {
            console.log(`${successful.length} out of ${numberOfMocks} mock tests generated.`);
        }
        
        console.log(`Each mock includes professionally designed content and analytical questions.`);
        console.log(`${'='.repeat(50)}`);

    } catch (error) {
        console.error("\n" + "=".repeat(50));
        console.error("FATAL ERROR");
        console.error("=".repeat(50));
        console.error(`Message: ${error.message}`);
        
        if (error.stack) {
            console.error(`\nStack trace:`);
            console.error(error.stack);
        }
        
        console.error(`\nTroubleshooting checklist:`);
        console.error(`1. Verify all file paths exist and are accessible`);
        console.error(`2. Check API keys are valid and have sufficient quota`);
        console.error(`3. Ensure PDF files are not corrupted and under 20MB`);
        console.error(`4. Verify you have write permissions to output directory`);
        console.error(`5. Check internet connection for API requests`);
        
        process.exit(1);
    }
}

// --- ERROR HANDLERS ---
process.on('unhandledRejection', (reason, promise) => {
    console.error('\n='.repeat(50));
    console.error('UNHANDLED PROMISE REJECTION');
    console.error('='.repeat(50));
    console.error('Promise:', promise);
    console.error('Reason:', reason);
    process.exit(1);
});

process.on('uncaughtException', (error) => {
    console.error('\n='.repeat(50));
    console.error('UNCAUGHT EXCEPTION');
    console.error('='.repeat(50));
    console.error('Error:', error);
    process.exit(1);
});

// --- EXPORT MAIN FUNCTION ---
export {
    main,
    generateSingleMock,
    generatePptFromJson,
    generatePdf,
    ApiKeyManager,
    parseJsonResponse,
    convertJsonToHtml,
    detectExamType,
    findPdfFiles,
    filesToGenerativeParts,
    EXAM_TYPE_PROMPTS
};

// --- RUN IF CALLED DIRECTLY ---
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(error => {
        console.error('\n='.repeat(50));
        console.error('APPLICATION ERROR');
        console.error('='.repeat(50));
        console.error('Error:', error.message);
        process.exit(1);
    });
}