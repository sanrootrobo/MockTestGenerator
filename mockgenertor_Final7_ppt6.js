import { GoogleGenAI } from "@google/genai";
import { program } from "commander";
import * as fs from "fs/promises";
import * as path from "path";
import puppeteer from "puppeteer";
import * as PptxAutomizerModule from 'pptx-automizer';
// Also try the named import as fallback
import PptxAutomizer, { modify, ModifyImageHelper } from 'pptx-automizer';
import * as cheerio from 'cheerio';

// --- SYSTEM PROMPT (UNCHANGED) ---
const systemPrompt = `You are an expert exam designer and question creator specializing in competitive entrance exams. Your primary task is to generate BRAND NEW, high-quality mock tests in HTML format with embedded CSS styling based on user requirements.

Follow these rules with absolute precision:

1.  **Analyze Reference Materials:**
    *   Carefully study all the provided "REFERENCE PYQ PDF" documents to understand question styles, common topics, section-wise distribution, difficulty level, and typical phrasing used in past exams.
    *   Examine the "REFERENCE Mock Test PDF" documents to understand their structure, formatting, layout, number of sections, and the tone of their instructions.

2.  **Generate Original Content:**
    *   You MUST NOT copy any questions or passages directly from the reference materials.
    *   The reference documents are for inspiration and style-matching ONLY.
    *   All questions, options, and solutions you generate must be entirely new and unique.

3.  **Process User Instructions:**
    *   The user will provide specific instructions for the mock test they want generated.
    *   Follow the user's requirements exactly regarding number of questions, topics to focus on, difficulty level, inclusion of answer key, exam format, etc.
    *   If there are conflicts between reference material patterns and user instructions, prioritize the user instructions.

4.  **Answer and Solution Placement Rule:**
    *   The **"Answer and Solution" section must appear only at the very end of the document**, after all questions have been listed.
    *   This section must contain both the **correct answer option** and a **brief but clear explanation/solution** for each question.
    *   Format each entry as: \`Q[number]: Option [X] – [Explanation]\`.
    *   Do not place answers or solutions immediately after questions or within the question section.

5.  **Format as Complete HTML Document:**
    *   The final output must be a complete, well-structured HTML document with embedded CSS.
    *   Include proper DOCTYPE, html, head, and body tags.
    *   All styling should be included in a <style> tag within the <head> section.
    *   Use semantic HTML elements and responsive design principles.
    *   Ensure the document is print-ready with appropriate page breaks and styling.

6.  **Diagram Generation (SVG):**
    *   For any question requiring a diagram (e.g., Venn diagrams, geometry figures) or a visual solution (e.g., direction-sense problems), you MUST provide a clear diagram.
    *   All diagrams must be drawn using **inline SVG** elements embedded directly in the HTML.
    *   Ensure all diagrams are well-labeled, properly sized, and directly relevant to the question or its solution.
    *   Style SVG elements with CSS for consistency with the overall design.

7.  **Professional Layout:**
    *   Create a professional, exam-like appearance with clear section divisions.
    *   Use appropriate typography, spacing, and color schemes.
    *   Include a header with exam details (title, duration, marks, instructions).
    *   Number questions clearly and format multiple-choice options consistently.
    *   The final "Answer and Solution" section must be clearly labeled and visually distinct from the questions section.

8.  **Print Optimization:**
    *   Ensure the HTML is optimized for PDF conversion.
    *   Use CSS print media queries where necessary.
    *   Implement proper page breaks to avoid splitting questions across pages.
    *   Use appropriate margins and font sizes for readability in PDF format.
    
9.  **CRITICAL TECHNICAL REQUIREMENT FOR HTML STRUCTURE:**
    *   This rule is MANDATORY and NON-NEGOTIABLE for the script's data extraction to function correctly.
    *   For every single question, you MUST use the following HTML structure with the exact class names specified.
    *   **Main Container:** Each question block MUST be a \`div\` with the class \`"question"\`.
      \`\`\`html
      <div class="question">
        <!-- All other question elements go inside here -->
      </div>
      \`\`\`
    *   **Question Number:** Inside the \`<div class="question">\`, the question number MUST be in an element with the class \`"question-number"\`.
      \`<span class="question-number">Q1.</span>\`
    *   **Question Text:** The main body of the question MUST be in an element with the class \`"question-text"\`.
      \`<p class="question-text">What is the primary function of a CPU?</p>\`
    *   **Options:** Each multiple-choice option MUST be in its own element with the class \`"option"\`.
      \`<div class="option">Data storage</div>\`
    *   **Answer Section**: The final answers must be inside a section with class \`"answer-solutions"\`, and each answer block must be a div with class \`"answer-item"\`.

Now, process the user's specific instructions and generate the mock test accordingly, strictly adhering to all rules, especially the critical HTML structure defined in Rule #9.`;



// --- FIXED PPTX GENERATION LOGIC using pptx-automizer ---

// --- IMPROVED PPTX GENERATION with direct SVG support ---

// --- FIXED PPTX GENERATION with better template handling ---

// --- FIXED PPTX GENERATION with better template handling ---

// --- FIXED PPTX GENERATION with better template handling ---
async function generatePpt(htmlContent, outputPath) {
    const templateName = 'template.pptx';
    const templatePath = path.join(process.cwd(), templateName);

    // Enhanced template validation
    try {
        console.log(`[PPTX] Looking for template at: ${templatePath}`);
        const templateStats = await fs.stat(templatePath);
        console.log(`[PPTX] Template found - Size: ${templateStats.size} bytes`);
    } catch (error) {
        console.error(`❌ CRITICAL: Template file not found at ${templatePath}`);
        console.error(`Current working directory: ${process.cwd()}`);

        // List files in current directory to help debug
        try {
            const files = await fs.readdir(process.cwd());
            const pptxFiles = files.filter(f => f.endsWith('.pptx'));
            console.error(`Available .pptx files in current directory:`);
            if (pptxFiles.length > 0) {
                pptxFiles.forEach(file => console.error(`  - ${file}`));
            } else {
                console.error(`  - No .pptx files found`);
            }
        } catch (listError) {
            console.error(`Could not list directory contents: ${listError.message}`);
        }

        console.error(`\nPlease ensure template.pptx exists with the following slides:`);
        console.error(`- Slide 1: Title slide`);
        console.error(`- Slide 2: Text Question (shapes: 'question_text', 'options_text')`);
        console.error(`- Slide 3: Visual Question (shapes: 'question_text', 'img_main', 'img_opt_a', 'img_opt_b', 'img_opt_c', 'img_opt_d')`);
        console.error(`- Slide 4: Answer Sheet (shape: 'answer_content')`);
        return;
    }

    try {
        // Get the Automizer constructor
        let Automizer;

        if (PptxAutomizer && typeof PptxAutomizer === 'function') {
            Automizer = PptxAutomizer;
        } else if (PptxAutomizer && PptxAutomizer.default && typeof PptxAutomizer.default === 'function') {
            Automizer = PptxAutomizer.default;
        } else if (PptxAutomizerModule && PptxAutomizerModule.default && typeof PptxAutomizerModule.default === 'function') {
            Automizer = PptxAutomizerModule.default;
        } else if (PptxAutomizerModule && typeof PptxAutomizerModule === 'function') {
            Automizer = PptxAutomizerModule;
        } else if (PptxAutomizerModule && PptxAutomizerModule.Automizer && typeof PptxAutomizerModule.Automizer === 'function') {
            Automizer = PptxAutomizerModule.Automizer;
        } else {
            console.error('Available exports from pptx-automizer:', Object.keys(PptxAutomizerModule || {}));
            console.error('PptxAutomizer type:', typeof PptxAutomizer);
            throw new Error('Could not find Automizer constructor in pptx-automizer module');
        }

        console.log(`[PPTX] Using Automizer constructor: ${Automizer.name || 'unnamed'}`);

        // Try different ways to initialize the automizer
        let automizer;
        let pres;

        try {
            // Method 1: Use absolute paths
            automizer = new Automizer({
                templateDir: process.cwd(),
                outputDir: path.dirname(outputPath)
            });

            console.log(`[PPTX] Automizer created with templateDir: ${process.cwd()}`);
            console.log(`[PPTX] Output directory: ${path.dirname(outputPath)}`);

            // Try to load the template
            pres = automizer.loadRoot(templateName);
            console.log(`[PPTX] Template loaded successfully: ${templateName}`);

        } catch (initError) {
            console.log(`[PPTX] Method 1 failed: ${initError.message}`);

            // Method 2: Try with just the filename in current directory
            try {
                automizer = new Automizer({
                    templateDir: '.',
                    outputDir: path.dirname(outputPath)
                });

                pres = automizer.loadRoot(templateName);
                console.log(`[PPTX] Template loaded with method 2`);

            } catch (method2Error) {
                console.log(`[PPTX] Method 2 failed: ${method2Error.message}`);

                // Method 3: Try with full path
                try {
                    automizer = new Automizer({
                        templateDir: path.dirname(templatePath),
                        outputDir: path.dirname(outputPath)
                    });

                    pres = automizer.loadRoot(path.basename(templatePath));
                    console.log(`[PPTX] Template loaded with method 3`);

                } catch (method3Error) {
                    console.log(`[PPTX] Method 3 failed: ${method3Error.message}`);

                    // Method 4: Try loading with full path directly
                    try {
                        automizer = new Automizer();
                        pres = automizer.loadRoot(templatePath);
                        console.log(`[PPTX] Template loaded with method 4 (full path)`);
                    } catch (method4Error) {
                        throw new Error(`All template loading methods failed. Last error: ${method4Error.message}`);
                    }
                }
            }
        }

        // Add the title slide
        pres = pres.addSlide(templateName, 1);
        console.log('[PPTX] Created new presentation with title slide');

        const $ = cheerio.load(htmlContent);

        // 1. Process Questions
        console.log('[PPTX] Processing question slides...');
        const questionElements = $('.question').get();
        console.log(`[PPTX] Found ${questionElements.length} questions to process`);

        for (let i = 0; i < questionElements.length; i++) {
            const el = questionElements[i];
            const $el = $(el);

            // Skip if no options found
            const options = $el.find('.option');
            if (options.length === 0) {
                console.warn(`[PPTX] Skipping question ${i + 1} - no options found`);
                continue;
            }

            // Extract question text (excluding options and SVGs)
            const $questionClone = $el.clone();
            $questionClone.find('.options, .option, .svg-container').remove();
            const questionText = $questionClone.text().trim().replace(/\s+/g, ' ');

            console.log(`[PPTX] Processing question ${i + 1}: ${questionText.substring(0, 50)}...`);

            // Extract SVG content directly as strings
            const questionSvg = $el.find('.question-text .svg-container svg, .svg-container svg').first();
            const questionSvgContent = questionSvg.length > 0 ? $.html(questionSvg) : null;

            // Check if any options contain SVGs
            const hasVisualOptions = $el.find('.option .svg-container svg, .option svg').length > 0;

            if (hasVisualOptions || questionSvgContent) {
                console.log(`[PPTX] Question ${i + 1} has visual content - using visual template`);

                // Extract option SVGs as strings
                const optionSvgs = [];
                for (let j = 0; j < options.length; j++) {
                    const $option = $(options[j]);
                    const optionSvg = $option.find('.svg-container svg, svg').first();

                    if (optionSvg.length > 0) {
                        optionSvgs.push($.html(optionSvg));
                    } else {
                        // If no SVG, get the text content
                        optionSvgs.push($option.text().trim());
                    }
                }

                // Add visual question slide - prepare SVG files first
                const svgFiles = [];

                // Pre-process main question SVG
                if (questionSvgContent) {
                    try {
                        const cleanSvg = questionSvgContent
                            .replace(/xmlns="[^"]*"/g, '')
                            .trim();

                        let fullSvg;
                        if (cleanSvg.startsWith('<svg')) {
                            fullSvg = cleanSvg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
                        } else {
                            fullSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">${cleanSvg}</svg>`;
                        }

                        const tempSvgPath = path.join(process.cwd(), `temp_question_${i + 1}.svg`);
                        await fs.writeFile(tempSvgPath, fullSvg);

                        svgFiles.push({
                            type: 'main',
                            path: tempSvgPath
                        });

                        console.log(`[PPTX] Pre-processed main SVG for question ${i + 1}`);
                    } catch (e) {
                        console.error(`[PPTX] Failed to pre-process main SVG for question ${i + 1}: ${e.message}`);
                    }
                }

                // Pre-process option SVGs
                for (let j = 0; j < optionSvgs.length && j < 5; j++) {
                    const optionContent = optionSvgs[j];

                    if (optionContent.includes('<svg')) {
                        try {
                            const cleanSvg = optionContent
                                .replace(/xmlns="[^"]*"/g, '')
                                .trim();

                            let fullSvg;
                            if (cleanSvg.startsWith('<svg')) {
                                fullSvg = cleanSvg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
                            } else {
                                fullSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 150">${cleanSvg}</svg>`;
                            }

                            const tempSvgPath = path.join(process.cwd(), `temp_option_${i + 1}_${j + 1}.svg`);
                            await fs.writeFile(tempSvgPath, fullSvg);

                            svgFiles.push({
                                type: 'option',
                                path: tempSvgPath,
                                index: j
                            });

                            console.log(`[PPTX] Pre-processed option ${j + 1} SVG for question ${i + 1}`);
                        } catch (e) {
                            console.error(`[PPTX] Failed to pre-process option ${j + 1} SVG: ${e.message}`);
                        }
                    }
                }

		// Simplified version - use only one slide type
		pres = pres.addSlide(1, (slide) => {
		    slide.modifyElement('question_text', modify.replaceText(questionText + '\n\n' + optionsText));
		});
                
            } else {
                console.log(`[PPTX] Question ${i + 1} is text-only - using text template`);

                // Text-only question
                const optionsText = options.map((j, opt) => {
                    const $opt = $(opt);
                    const optionText = $opt.text().trim();
                    const optionLetter = String.fromCharCode(65 + j); // A, B, C, D, E...
                    return `(${optionLetter}) ${optionText}`;
                }).get().join('\n\n');

                // Add text question slide
                pres = pres.addSlide(templateName, 2, (slide) => {
                    try {
                        slide.modifyElement('question_text', modify.replaceText(questionText));
                        slide.modifyElement('options_text', modify.replaceText(optionsText));
                        console.log(`[PPTX] Added text slide for question ${i + 1}`);
                    } catch (e) {
                        console.error(`[PPTX] Error modifying text slide for question ${i + 1}: ${e.message}`);
                    }
                });
            }
        }

        // 2. Process Answer Sheet
        console.log('[PPTX] Processing answer slides...');
        const answerItems = [];

        $('.answer-solutions .answer-item, .answer-item').each((i, el) => {
            const $el = $(el);

            let answerKey = $el.find('.answer-key').text().trim();
            if (!answerKey) {
                const text = $el.text().trim();
                const match = text.match(/^(Q?\d+)[:\.\s]+([A-E])/i);
                if (match) {
                    answerKey = `${match[1]}: ${match[2]}`;
                }
            }

            let solutionText = $el.find('.solution-text, .solution').text().trim();
            if (!solutionText) {
                const fullText = $el.text().trim();
                if (answerKey) {
                    solutionText = fullText.replace(answerKey, '').replace(/^[\s\-–—]+/, '').trim();
                } else {
                    solutionText = fullText;
                }
            }

            if (answerKey || solutionText) {
                const formattedAnswer = answerKey ? `${answerKey}${solutionText ? ' – ' + solutionText : ''}` : solutionText;
                answerItems.push(formattedAnswer);
            }
        });

        if (answerItems.length === 0) {
            const answerSection = $('.answer-solutions, .answer-key').text().trim();
            if (answerSection) {
                const lines = answerSection.split(/\n|Q\d+/).filter(line => line.trim().length > 0);
                lines.forEach(line => {
                    const cleanLine = line.trim().replace(/^[\s\-–—]+/, '');
                    if (cleanLine) {
                        answerItems.push(cleanLine);
                    }
                });
            }
        }

        console.log(`[PPTX] Found ${answerItems.length} answer items`);

        if (answerItems.length > 0) {
            const LINES_PER_SLIDE = 25;
            let currentChunk = '';
            let currentLines = 0;

            for (const item of answerItems) {
                const itemLines = (item.match(/\n/g) || []).length + 1;

                if (currentLines + itemLines > LINES_PER_SLIDE && currentLines > 0) {
                    const chunkContent = currentChunk.trim();
                    pres = pres.addSlide(templateName, 4, (slide) => {
                        try {
                            slide.modifyElement('answer_content', modify.replaceText(chunkContent));
                            console.log('[PPTX] Added answer slide with content');
                        } catch (e) {
                            console.error(`[PPTX] Error adding answer slide: ${e.message}`);
                        }
                    });

                    currentChunk = '';
                    currentLines = 0;
                }

                currentChunk += item + '\n\n';
                currentLines += itemLines + 1;
            }

            if (currentChunk.trim()) {
                const finalContent = currentChunk.trim();
                pres = pres.addSlide(templateName, 4, (slide) => {
                    try {
                        slide.modifyElement('answer_content', modify.replaceText(finalContent));
                        console.log('[PPTX] Added final answer slide');
                    } catch (e) {
                        console.error(`[PPTX] Error adding final answer slide: ${e.message}`);
                    }
                });
            }
        } else {
            console.warn('[PPTX] No answer content found to add to slides');
        }

        // 3. Save the final presentation
        const outputFilename = path.basename(outputPath);
        await pres.write(outputFilename);
        console.log(`✅ PowerPoint generated successfully: ${outputFilename}`);

    } catch (error) {
        console.error(`❌ PowerPoint generation failed: ${error.message}`);
        console.error(`Stack trace: ${error.stack}`);

        // Additional debugging information
        console.error(`\nDebugging information:`);
        console.error(`- Current working directory: ${process.cwd()}`);
        console.error(`- Template path: ${templatePath}`);
        console.error(`- Output path: ${outputPath}`);
    }
}

// Remove the renderSvgToPng function entirely - it's no longer needed

// --- THE REST OF THE SCRIPT REMAINS THE SAME ---

// Enhanced CSS styles for direct HTML generation
const getHtmlTemplate = (content, title = "Mock Test") => {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
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
        
        /* Headers */
        h1 {
            color: #1a202c;
            font-size: 28px;
            font-weight: 700;
            margin: 0 0 24px 0;
            text-align: center;
            border-bottom: 3px solid #4299e1;
            padding-bottom: 12px;
            page-break-after: avoid;
        }
        
        h2 {
            color: #2b6cb0;
            font-size: 22px;
            font-weight: 600;
            margin: 32px 0 16px 0;
            border-left: 4px solid #4299e1;
            padding-left: 12px;
            page-break-after: avoid;
        }
        
        h3 {
            color: #2c5282;
            font-size: 18px;
            font-weight: 600;
            margin: 24px 0 12px 0;
            page-break-after: avoid;
        }
        
        h4 {
            color: #2a4365;
            font-size: 16px;
            font-weight: 500;
            margin: 20px 0 10px 0;
            page-break-after: avoid;
        }
        
        /* Paragraphs and text */
        p {
            margin: 0 0 12px 0;
            text-align: justify;
        }
        
        /* Lists */
        ul, ol {
            margin: 12px 0;
            padding-left: 24px;
        }
        
        li {
            margin: 4px 0;
            line-height: 1.5;
        }
        
        /* Questions styling */
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
        
        .option:hover {
            background: #edf2f7;
        }
        
        /* Answer key styling */
        .answer-key, .answer-solutions {
            background: #f0fff4;
            border: 2px solid #38a169;
            border-radius: 8px;
            padding: 20px;
            margin: 32px 0;
            page-break-inside: avoid;
        }
        
        .answer-key h2, .answer-key h3, .answer-solutions h2, .answer-solutions h3 {
            color: #22543d;
            border-left-color: #38a169;
        }
        
        .answer-item {
            margin: 6px 0;
            padding: 6px 12px;
            background: #ffffff;
            border-radius: 4px;
            border: 1px solid #c6f6d5;
            line-height: 1.5;
        }
        
        .answer-number {
            font-weight: 600;
            color: #22543d;
            min-width: 40px;
        }
        
        .answer-value {
            font-weight: 500;
            color: #2f855a;
        }
        
        /* Instructions and notes */
        .instructions {
            background: #fffaf0;
            border: 1px solid #fbd38d;
            border-radius: 8px;
            padding: 16px;
            margin: 16px 0;
            page-break-inside: avoid;
        }
        
        .instructions h3 {
            color: #c05621;
            margin-top: 0;
        }
        
        /* Code blocks and technical content */
        code {
            background: #edf2f7;
            padding: 2px 6px;
            border-radius: 3px;
            font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
            font-size: 13px;
        }
        
        pre {
            background: #f7fafc;
            border: 1px solid #e2e8f0;
            border-radius: 6px;
            padding: 16px;
            margin: 16px 0;
            overflow-x: auto;
            font-size: 13px;
            line-height: 1.4;
        }
        
        pre code {
            background: none;
            padding: 0;
        }

        /* SVG Container for diagrams */
        .svg-container {
            display: flex;
            justify-content: center;
            align-items: center;
            margin: 20px 0;
            page-break-inside: avoid;
        }
        
        .svg-container svg {
            border: 1px solid #e2e8f0;
            border-radius: 4px;
            background: #ffffff;
            max-width: 100%;
            height: auto;
        }
        
        /* Tables */
        table {
            width: 100%;
            border-collapse: collapse;
            margin: 16px 0;
            font-size: 13px;
        }
        
        th, td {
            border: 1px solid #e2e8f0;
            padding: 8px 12px;
            text-align: left;
        }
        
        th {
            background: #f7fafc;
            font-weight: 600;
            color: #2d3748;
        }
        
        tr:nth-child(even) {
            background: #f9fafb;
        }
        
        /* Blockquotes */
        blockquote {
            border-left: 4px solid #cbd5e0;
            margin: 16px 0;
            padding: 12px 16px;
            background: #f7fafc;
            font-style: italic;
            color: #4a5568;
        }
        
        /* Strong and emphasis */
        strong {
            font-weight: 600;
            color: #1a202c;
        }
        
        em {
            font-style: italic;
            color: #4a5568;
        }
        
        /* Links */
        a {
            color: #3182ce;
            text-decoration: none;
        }
        
        a:hover {
            text-decoration: underline;
        }
        
        /* Page breaks */
        .page-break {
            page-break-before: always;
        }
        
        .no-break {
            page-break-inside: avoid;
        }
        
        /* Utility classes */
        .text-center {
            text-align: center;
        }
        
        .text-right {
            text-align: right;
        }
        
        .mt-4 {
            margin-top: 16px;
        }
        
        .mb-4 {
            margin-bottom: 16px;
        }
        
        .p-4 {
            padding: 16px;
        }
        
        /* Print optimizations */
        @media print {
            body {
                font-size: 12px;
                line-height: 1.4;
                padding: 10px;
            }
            
            h1 {
                font-size: 24px;
            }
            
            h2 {
                font-size: 18px;
            }
            
            h3 {
                font-size: 16px;
            }
            
            .question {
                margin: 12px 0;
                padding: 12px;
            }
            
            .answer-key, .answer-solutions {
                margin: 24px 0;
                padding: 16px;
            }
            
            .page-break {
                page-break-before: always;
            }
            
            .no-break {
                page-break-inside: avoid;
            }
        }
        
        /* Section dividers */
        .section-divider {
            border-top: 2px solid #e2e8f0;
            margin: 32px 0 24px 0;
            padding-top: 24px;
        }
        
        /* Footer for each page */
        .page-footer {
            position: fixed;
            bottom: 20px;
            right: 20px;
            font-size: 11px;
            color: #718096;
        }
        
        /* Header info */
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
            border-bottom: none;
            margin-bottom: 8px;
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
        
        /* Section headers */
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
        
        .section-subtitle {
            font-size: 14px;
            color: #6c757d;
            margin: 5px 0 0 0;
        }
        
        /* Answer key grid */
        .answer-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 10px;
            margin: 20px 0;
        }
        
        /* Responsive design */
        @media screen and (max-width: 768px) {
            body {
                padding: 10px;
                font-size: 13px;
            }
            
            .test-info {
                flex-direction: column;
                gap: 10px;
            }
            
            .answer-grid {
                grid-template-columns: 1fr;
            }
        }
    </style>
</head>
<body>
    ${content}
    <div class="page-footer">Generated Mock Test</div>
</body>
</html>`;
};

// Global API key management with parallel usage support
class ApiKeyManager {
    constructor(apiKeys) {
        this.apiKeys = apiKeys.map(key => key.trim()).filter(key => key.length > 0);
        this.keyUsageCount = new Map();
        this.failedKeys = new Set();
        this.keyAssignments = new Map(); // Track which mock is using which key
        this.keyLocks = new Map(); // Track which keys are currently in use
        
        // Initialize usage count and locks for each key
        this.apiKeys.forEach((key, index) => {
            this.keyUsageCount.set(index, 0);
            this.keyLocks.set(index, false);
        });
        
        console.log(`📋 Loaded ${this.apiKeys.length} API keys for parallel usage`);
    }

    // Assign a specific key to a mock (round-robin distribution)
    assignKeyToMock(mockNumber) {
        if (this.failedKeys.size === this.apiKeys.length) {
            throw new Error("All API keys have failed or exceeded quota");
        }
        
        // Use round-robin assignment, skipping failed keys
        let keyIndex = (mockNumber - 1) % this.apiKeys.length;
        let attempts = 0;
        
        // Find next available key if current one is failed
        while (this.failedKeys.has(keyIndex) && attempts < this.apiKeys.length) {
            keyIndex = (keyIndex + 1) % this.apiKeys.length;
            attempts++;
        }
        
        if (this.failedKeys.has(keyIndex)) {
            throw new Error("No available API keys");
        }
        
        // Store the assignment
        this.keyAssignments.set(mockNumber, keyIndex);
        
        return {
            key: this.apiKeys[keyIndex],
            index: keyIndex
        };
    }

    // Get the assigned key for a specific mock
    getKeyForMock(mockNumber) {
        const keyIndex = this.keyAssignments.get(mockNumber);
        if (keyIndex === undefined) {
            throw new Error(`No key assigned to mock ${mockNumber}`);
        }
        
        if (this.failedKeys.has(keyIndex)) {
            // Key has failed, need to reassign
            console.log(`🔄 Reassigning key for mock ${mockNumber} (previous key failed)`);
            return this.assignKeyToMock(mockNumber);
        }
        
        return {
            key: this.apiKeys[keyIndex],
            index: keyIndex
        };
    }

    // Get next available key (fallback for retries)
    getNextAvailableKey(excludeIndex = -1) {
        if (this.failedKeys.size === this.apiKeys.length) {
            throw new Error("All API keys have failed or exceeded quota");
        }
        
        // Find next available key, excluding the specified index
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
        
        // Remove any assignments using this failed key
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
        const assignmentStats = {};
        for (const [mockNumber, keyIndex] of this.keyAssignments.entries()) {
            if (!assignmentStats[keyIndex]) {
                assignmentStats[keyIndex] = [];
            }
            assignmentStats[keyIndex].push(mockNumber);
        }
        
        return {
            totalKeys: this.apiKeys.length,
            failedKeys: this.failedKeys.size,
            availableKeys: this.apiKeys.length - this.failedKeys.size,
            usage: Object.fromEntries(this.keyUsageCount),
            assignments: assignmentStats
        };
    }

    // Get load distribution info
    getLoadDistribution() {
        const distribution = {};
        this.apiKeys.forEach((_, index) => {
            if (!this.failedKeys.has(index)) {
                distribution[`Key ${index + 1}`] = this.keyUsageCount.get(index) || 0;
            }
        });
        return distribution;
    }
}

let apiKeyManager = null;

// --- Helper Functions ---

// Validates thinking budget for specific models
function validateThinkingBudget(budget, model) {
    if (budget === undefined) return null;
    
    const budgetNum = parseInt(budget);
    
    // Dynamic thinking
    if (budgetNum === -1) return -1;
    
    // Disable thinking (only for Flash and Flash-Lite)
    if (budgetNum === 0) {
        if (model.includes('pro')) {
            console.warn("⚠️  Warning: Thinking cannot be disabled for Gemini Pro models. Using minimum budget (128) instead.");
            return 128;
        }
        return 0;
    }
    
    // Validate budget ranges based on model
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

// Create generation config with thinking budget
function createGenerationConfig(options, model) {
    const config = {};
    
    // Add basic generation parameters
    if (options.maxTokens && options.maxTokens !== 8192) {
        config.maxOutputTokens = options.maxTokens;
    }
    
    if (options.temperature && options.temperature !== 0.7) {
        config.temperature = options.temperature;
    }
    
    // Add thinking config if specified
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

// Convert HTML to PDF using Puppeteer
async function generatePdf(htmlContent, outputPath) {
    let browser = null;
    try {
        console.log('📄 Launching browser for PDF generation...');
        browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        
        const page = await browser.newPage();
        
        // Set content and wait for any fonts to load
        await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
        
        // Generate PDF with optimized settings
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

// Finds all PDF files in a given directory
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

// Check file size and warn if it's too large
async function getFileSize(filePath) {
    try {
        const stats = await fs.stat(filePath);
        return stats.size;
    } catch (error) {
        console.error(`Warning: Could not get file size for ${filePath}`);
        return 0;
    }
}

// Converts an array of file paths into the format required by the Gemini API
async function filesToGenerativeParts(filePaths, label) {
    const parts = [];
    const maxFileSize = 20 * 1024 * 1024; // 20MB limit for inline data
    
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

// Validate API key format
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

// Check if directories exist
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

// Generate output filename for multiple mocks (PDF only)
function generateOutputFilename(baseOutput, mockNumber, totalMocks) {
    const baseName = path.basename(baseOutput, path.extname(baseOutput));
    const dir = path.dirname(baseOutput);
    
    if (totalMocks === 1) {
        return path.join(dir, baseName + '.pdf');
    }
    
    const paddedNumber = String(mockNumber).padStart(String(totalMocks).length, '0');
    const newFilename = `${baseName}_${paddedNumber}.pdf`;
    return path.join(dir, newFilename);
}

// NEW: Generate filename for the debug HTML file
function generateDebugHtmlFilename(baseOutput, mockNumber, totalMocks) {
    const baseName = path.basename(baseOutput, path.extname(baseOutput));
    const dir = path.dirname(baseOutput);

    if (totalMocks === 1) {
        return path.join(dir, `${baseName}_debug.html`);
    }

    const paddedNumber = String(mockNumber).padStart(String(totalMocks).length, '0');
    return path.join(dir, `${baseName}_${paddedNumber}_debug.html`);
}

// Generate output filename for PowerPoint files
function generatePptOutputFilename(baseOutput, mockNumber, totalMocks) {
    const baseName = path.basename(baseOutput, path.extname(baseOutput));
    const dir = path.dirname(baseOutput);
    const extension = '.pptx';

    if (totalMocks === 1) {
        return path.join(dir, baseName + extension);
    }

    const paddedNumber = String(mockNumber).padStart(String(totalMocks).length, '0');
    const newFilename = `${baseName}_${paddedNumber}${extension}`;
    return path.join(dir, newFilename);
}

// Extract title from HTML content
function extractTitleFromHtml(htmlContent) {
    const $ = cheerio.load(htmlContent);
    const title = $('h1').first().text().trim();
    return title || "Mock Test";
}

// Generate a single mock test with retry logic and dedicated API key
async function generateSingleMock(contents, outputPath, mockNumber, totalMocks, options) {
    const maxRetries = 3;
    let lastError = null;
    let currentKeyInfo = null;

    // Assign a dedicated key to this mock (round-robin)
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
            
            // Add rate limiting delay (reduced since we're using different keys)
            if (options.rateLimitDelay && options.rateLimitDelay > 0) {
                const adjustedDelay = Math.max(100, options.rateLimitDelay / apiKeyManager.apiKeys.length);
                await new Promise(resolve => setTimeout(resolve, adjustedDelay));
            }
            
            const response = await genAI.models.generateContent(requestParams);
            
            if (!response || !response.text) {
                throw new Error("No response received from API");
            }
            
            const generatedHtml = response.text;
            
            if (!generatedHtml || generatedHtml.trim().length === 0) {
                throw new Error("Empty response received from API");
            }

            // Log token usage if available
            if (response.usageMetadata) {
                const usage = response.usageMetadata;
                console.log(`📊 Token usage (Key ${currentKeyInfo.index + 1}) - Input: ${usage.promptTokenCount || 'N/A'}, Output: ${usage.candidatesTokenCount || 'N/A'}, Thinking: ${usage.thoughtsTokenCount || 'N/A'}`);
            }

            // Ensure output directory exists
            const outputDir = path.dirname(outputPath);
            if (outputDir !== '.') {
                await fs.mkdir(outputDir, { recursive: true });
            }

            // Process HTML content - if it's not a complete HTML document, wrap it
            let finalHtmlContent;
            if (generatedHtml.includes('<!DOCTYPE html>') || generatedHtml.includes('<html>')) {
                // Already a complete HTML document
                finalHtmlContent = generatedHtml;
            } else {
                // Wrap the content in our template
                const title = extractTitleFromHtml(generatedHtml) || `Mock Test ${mockNumber}`;
                finalHtmlContent = getHtmlTemplate(generatedHtml, title);
            }

            // --- Save debug HTML file if requested ---
            if (options.saveHtml) {
                const debugHtmlPath = generateDebugHtmlFilename(options.output, mockNumber, totalMocks);
                try {
                    await fs.writeFile(debugHtmlPath, finalHtmlContent);
                    console.log(`[DEBUG] Raw HTML for mock ${mockNumber} saved to: ${debugHtmlPath}`);
                } catch(e) {
                    console.error(`[DEBUG] Failed to save debug HTML file: ${e.message}`);
                }
            }

            // Generate PDF directly
            console.log(`📄 Converting to PDF: ${path.basename(outputPath)}`);
            await generatePdf(finalHtmlContent, outputPath);

            // Generate PPT if requested
            if (options.ppt) {
                const pptOutputPath = generatePptOutputFilename(options.output, mockNumber, totalMocks);
                await generatePpt(finalHtmlContent, pptOutputPath);
            }
            
            // Update usage stats
            apiKeyManager.incrementUsage(currentKeyInfo.index);
            
            console.log(`✅ Mock ${mockNumber}/${totalMocks} completed with API Key ${currentKeyInfo.index + 1}: ${path.basename(outputPath)}`);
            console.log(`📄 Generated content length: ${generatedHtml.length} characters`);
            
            return {
                success: true,
                outputPath: outputPath,
                contentLength: generatedHtml.length,
                keyIndex: currentKeyInfo.index,
                usage: response.usageMetadata,
                mockNumber: mockNumber,
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
            
            // Wait before retrying (exponential backoff, but shorter since using different keys)
            const waitTime = Math.pow(1.5, attempt - 1) * 500; // Reduced wait time
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

// --- Main Execution Logic ---

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
        .option("--ppt", "Generate a PowerPoint (.pptx) file from the HTML content")
        .option("--save-html", "Save the raw generated HTML to a debug file.")
        .parse(process.argv);

    const options = program.opts();
    const apiKeyFile = options.apiKeyFile || "api_key.txt";
    const numberOfMocks = parseInt(options.numberOfMocks) || 1; 
    const maxConcurrent = options.concurrentLimit || 3;
    const rateDelay = options.rateLimitDelay || 1000;
    const thinkingBudget = options.thinkingBudget;
    const modelName = options.model || "gemini-2.5-pro";

    if (!numberOfMocks || isNaN(numberOfMocks) || numberOfMocks < 1) {
        console.error(`Error: --number-of-mocks must be a positive integer, got: ${numberOfMocks}`);
        process.exit(1);
    }

    try {
        await import('puppeteer');
        console.log('✅ Puppeteer available - PDF generation is enabled.');
    } catch (error) {
        console.error('❌ Puppeteer is required for PDF generation but is not installed.');
        console.error('Please install it with: npm install puppeteer');
        process.exit(1);
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
        let outputFormats = ["PDF"];
        if (options.ppt) outputFormats.push("PowerPoint");
        console.log(`📄 Output Formats: ${outputFormats.join(' and ')}`);
        if (options.saveHtml) {
            console.log("💾 Debug HTML files will be saved.");
        }
        
        const startTime = Date.now();
        
        const generationTasks = [];
        for (let i = 1; i <= numberOfMocks; i++) {
            const outputPath = generateOutputFilename(options.output, i, numberOfMocks);
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
                    const pptOutputPath = generatePptOutputFilename(options.output, mockResult.mockNumber, numberOfMocks);
                    console.log(`  📊 ${path.basename(pptOutputPath)}`);
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
