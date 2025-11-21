import PptxGenJS from 'pptxgenjs';
import * as fs from 'fs/promises';
import { program } from 'commander';
import * as path from 'path';

// Convert HTML to PowerPoint rich text
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
                options: { 
                    bold: isBold,
                    fontSize: 11,
                    fontFace: 'Calibri'
                } 
            });
        }
    });
    
    return richText.length > 0 ? richText : [{ text: textWithNewlines }];
}

// Convert SVG to base64
function svgToBase64(svgContent) {
    if (!svgContent || !svgContent.includes('<svg')) return null;
    const svgMatch = svgContent.match(/<svg[^>]*>[\s\S]*?<\/svg>/i);
    if (!svgMatch) return null;

    let svgString = svgMatch[0];

    if (!svgString.includes('viewBox=')) {
        svgString = svgString.replace('<svg', '<svg viewBox="0 0 400 300"');
    }

    svgString = svgString.replace(/<svg([^>]*)>/i, (match, attributes) => {
        let newAttributes = attributes;
        if (!attributes.includes('width=')) {
            newAttributes += ' width="400"';
        }
        if (!attributes.includes('height=')) {
            newAttributes += ' height="300"';
        }
        return `<svg${newAttributes}>`;
    });

    return `data:image/svg+xml;base64,${Buffer.from(svgString).toString('base64')}`;
}

// Add slide with background
function addSlideWithBackground(pptx, backgroundPath) {
    const slide = pptx.addSlide();
    if (backgroundPath) {
        slide.background = { path: backgroundPath };
    }
    return slide;
}

// Create title slide
function createTitleSlide(pptx, data, bgImagePath) {
    const slide = addSlideWithBackground(pptx, bgImagePath);
    slide.addText(data.examTitle, {
        x: 0.5, y: 1.5, w: '90%', h: 1, 
        fontSize: 40, bold: true, color: '003B75', align: 'center',
    });
    const details = data.examDetails;
    const detailsText = `Total Questions: ${details.totalQuestions}  |  Time: ${details.timeAllotted}  |  Max Marks: ${details.maxMarks}`;
    slide.addText(detailsText, {
        x: 0.5, y: 3.0, w: '90%', h: 0.5, 
        fontSize: 20, color: '333333', align: 'center',
    });
}

// Create instructions slide
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

// Create slide with directions and table/chart (optimized for DI)
function createDirectionsAndDataSlide(pptx, directions, bgImagePath) {
    const slide = addSlideWithBackground(pptx, bgImagePath);
    
    let currentY = 0.3;
    
    // Add directions title and text
    if (directions) {
        slide.addText(directions.title || 'Directions', {
            x: 0.3, y: currentY, w: '90%', h: 0.4,
            fontSize: 14, fontFace: 'Calibri',
            bold: true, color: '1A365D'
        });
        currentY += 0.5;
        
        const cleanDirections = directions.text
            .replace(/<[^>]*>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        
        slide.addText(cleanDirections, {
            x: 0.3, y: currentY, w: '90%', h: 'auto',
            fontSize: 11, fontFace: 'Calibri',
            color: '333333', wrap: true
        });
        currentY += 1.2;
    }
    
    return { slide, currentY };
}

// Create question slide (optimized for DI - minimal info)
function createQuestionSlide(pptx, question, bgImagePath) {
    const slide = addSlideWithBackground(pptx, bgImagePath);

    slide.addText(`Question ${question.questionNumber}`, { 
        x: 0.3, y: 0.2, w: '90%', h: 0.4,
        fontSize: 12, fontFace: 'Calibri',
        bold: true, color: '1A365D'
    });

    let currentY = 0.7;

    // Question text
    const questionTextLength = question.questionText.length;
    let questionTextHeight;
    if (questionTextLength > 300) questionTextHeight = 2.0;
    else if (questionTextLength > 150) questionTextHeight = 1.5;
    else questionTextHeight = 1.0;

    slide.addText(convertHtmlToPptxRichText(question.questionText), {
        x: 0.3, y: currentY, w: '90%', h: questionTextHeight,
        fontSize: 11, fontFace: 'Calibri',
        wrap: true
    });
    currentY += questionTextHeight + 0.3;

    // Question SVG/Chart (if present and not already shown in directions)
    if (question.svg) {
        const base64Svg = svgToBase64(question.svg);
        if (base64Svg) {
            const remainingHeight = 7.5 - currentY - (question.options.length * 0.35);
            const imageHeight = Math.min(3, Math.max(1.5, remainingHeight * 0.6));
            const imageWidth = imageHeight * 1.33;
            const imageX = (10 - imageWidth) / 2;
            
            slide.addImage({ 
                data: base64Svg, 
                x: imageX, 
                y: currentY, 
                w: imageWidth, 
                h: imageHeight,
                sizing: { type: 'contain' }
            });
            currentY += imageHeight + 0.3;
        }
    }

    // Options
    const optionsPerRow = question.options.some(opt => opt.svg) ? 2 : 1;
    const optionWidth = optionsPerRow === 2 ? '42%' : '85%';
    let optionX = 0.5;
    let optionCount = 0;

    question.options.forEach(opt => {
        if (optionsPerRow === 2 && optionCount % 2 === 1) {
            optionX = 5.2;
        } else {
            optionX = 0.5;
        }

        const optionText = `${opt.label}) ${opt.text || ''}`;
        
        if (opt.svg) {
            slide.addText(`${opt.label})`, { 
                x: optionX, y: currentY, w: 0.5, h: 0.3, 
                fontSize: 10, fontFace: 'Calibri', bold: true
            });
            
            const base64Svg = svgToBase64(opt.svg);
            if (base64Svg) {
                slide.addImage({ 
                    data: base64Svg, 
                    x: optionX + 0.6, 
                    y: currentY - 0.1, 
                    w: 1.5, 
                    h: 1,
                    sizing: { type: 'contain' }
                });
            }
            
            if (optionsPerRow === 1 || optionCount % 2 === 1) {
                currentY += 1.2;
            }
        } else {
            slide.addText(optionText, { 
                x: optionX, 
                y: currentY, 
                w: optionWidth, 
                h: 0.3, 
                fontSize: 10, 
                fontFace: 'Calibri'
            });
            
            if (optionsPerRow === 1 || optionCount % 2 === 1) {
                currentY += 0.35;
            }
        }
        
        optionCount++;
    });
}

// Create answer slide (detailed and descriptive for DI)
function createAnswerSlide(pptx, question, bgImagePath) {
    const slide = addSlideWithBackground(pptx, bgImagePath);

    // Title
    slide.addText(`Answer & Solution: Q${question.questionNumber}`, {
        x: 0.3, y: 0.3, w: '90%',
        fontSize: 14, fontFace: 'Calibri',
        bold: true, color: '1A365D'
    });

    // Answer
    slide.addText(`Correct Answer: ${question.solution.answer}`, {
        x: 0.3, y: 0.8, w: '90%', h: 0.4,
        fontSize: 12, fontFace: 'Calibri',
        bold: true, color: '2E7D32'
    });

    let currentY = 1.3;

    // Steps (detailed and descriptive)
    if (question.solution.steps && question.solution.steps.length > 0) {
        slide.addText('Solution Steps:', {
            x: 0.3, y: currentY, w: '90%', h: 0.3,
            fontSize: 11, fontFace: 'Calibri',
            bold: true, color: '1A365D'
        });
        currentY += 0.4;

        const hasSvg = question.solution.svg && svgToBase64(question.solution.svg);
        const textWidth = hasSvg ? '48%' : '88%';

        question.solution.steps.forEach((step, index) => {
            const stepText = `${index + 1}. ${step}`;
            const stepHeight = Math.max(0.4, Math.ceil(step.length / 80) * 0.3);
            
            slide.addText(stepText, {
                x: 0.5, y: currentY, w: textWidth, h: stepHeight,
                fontSize: 10, fontFace: 'Calibri',
                color: '424242', wrap: true,
                valign: 'top'
            });
            currentY += stepHeight + 0.1;
        });

        // SVG on the right side if available
        if (hasSvg) {
            slide.addImage({
                data: svgToBase64(question.solution.svg),
                x: 5.3, y: 1.7, w: 4.2, h: 3.5,
                sizing: { type: 'contain' }
            });
        }
    }
}

// Main PPT generation function
async function generatePptFromJson(jsonData, outputPath, backgroundPath) {
    try {
        console.log('Creating PowerPoint presentation...');
        
        const pptx = new PptxGenJS();
        
        // Title slide
        createTitleSlide(pptx, jsonData, backgroundPath);
        
        // Instructions slide
        createInstructionsSlide(pptx, jsonData, backgroundPath);

        // Process sections
        jsonData.sections.forEach(section => {
            section.questionSets.forEach(qSet => {
                const directions = qSet.type === 'group' ? qSet.directions : null;
                
                // For DI: Create directions + data slide if there are shared directions
                if (directions) {
                    createDirectionsAndDataSlide(pptx, directions, backgroundPath);
                }
                
                // Create question slides
                qSet.questions.forEach(q => {
                    createQuestionSlide(pptx, q, backgroundPath);
                });
            });
        });

        // Answers divider slide
        const answerTitleSlide = addSlideWithBackground(pptx, backgroundPath);
        answerTitleSlide.addText('Answers & Solutions', { 
            x: 0, y: '45%', w: '100%', align: 'center', 
            fontSize: 44, color: '003B75', bold: true 
        });

        // Create answer slides (detailed)
        jsonData.sections.forEach(section => {
            section.questionSets.forEach(qSet => {
                qSet.questions.forEach(q => {
                    createAnswerSlide(pptx, q, backgroundPath);
                });
            });
        });

        // Save presentation
        await pptx.writeFile({ fileName: outputPath });
        console.log(`PowerPoint generated: ${path.basename(outputPath)}`);
        
    } catch (error) {
        console.error(`PowerPoint generation failed: ${error.message}`);
        throw error;
    }
}

// Main function
async function main() {
    program
        .requiredOption('-i, --input <file>', 'Input JSON file path')
        .requiredOption('-o, --output <file>', 'Output PowerPoint file path (.pptx)')
        .option('-b, --background <file>', 'Background image for slides')
        .parse(process.argv);

    const options = program.opts();

    try {
        // Read JSON file
        console.log(`Reading JSON from: ${options.input}`);
        const jsonContent = await fs.readFile(options.input, 'utf-8');
        const jsonData = JSON.parse(jsonContent);

        // Validate JSON structure
        if (!jsonData.examTitle || !jsonData.examDetails || !jsonData.sections) {
            throw new Error('Invalid JSON structure - missing required fields');
        }

        // Generate PowerPoint
        await generatePptFromJson(jsonData, options.output, options.background);
        
        console.log('Success!');

    } catch (error) {
        console.error(`Error: ${error.message}`);
        process.exit(1);
    }
}

main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});