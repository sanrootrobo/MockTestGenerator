import PptxGenJS from 'pptxgenjs';
import fs from 'fs';
import path from 'path';

// --- HELPER FUNCTIONS ---

/**
 * Converts basic HTML tags like <br> and <strong> to pptxgenjs rich text format.
 * @param {string} html - The HTML string to convert.
 * @returns {Array} An array of rich text objects for pptxgenjs.
 */
function convertHtmlToPptxRichText(html) {
    if (!html) return [{ text: '' }];

    // Replace <br> and <p> tags with newlines
    const textWithNewlines = html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/?p>/gi, '');

    // Split by <strong> and </strong> to handle bolding
    const parts = textWithNewlines.split(/(<\/?strong>)/g);

    const richText = [];
    let isBold = false;

    parts.forEach(part => {
        if (part === '<strong>') {
            isBold = true;
        } else if (part === '</strong>') {
            isBold = false;
        } else if (part) {
            richText.push({ text: part, options: { bold: isBold } });
        }
    });
    
    // Fallback if no tags were found
    if (richText.length === 0) {
        return [{ text: textWithNewlines }];
    }

    return richText;
}


/**
 * Extracts the raw SVG string and converts it to a base64 data URI.
 * @param {string} svgContent - The string containing the SVG tag.
 * @returns {string|null} Base64 data URI or null if no SVG is found.
 */
function svgToBase64(svgContent) {
    if (!svgContent || !svgContent.includes('<svg')) return null;
    const svgMatch = svgContent.match(/<svg[^>]*>[\s\S]*?<\/svg>/i);
    if (!svgMatch) return null;

    const svgString = svgMatch[0];
    const base64 = Buffer.from(svgString).toString('base64');
    return `data:image/svg+xml;base64,${base64}`;
}


// --- SLIDE CREATION FUNCTIONS ---

function createTitleSlide(pptx, data) {
    let slide = pptx.addSlide();
    slide.background = { color: 'F4F4F4' };

    slide.addText(data.examTitle, {
        x: 0.5,
        y: 1.5,
        w: '90%',
        h: 1,
        fontSize: 36,
        fontFace: 'Arial',
        bold: true,
        color: '1A365D',
        align: 'center',
    });

    const details = data.examDetails;
    const detailsText = `Total Questions: ${details.totalQuestions}  |  Time Allotted: ${details.timeAllotted}  |  Max Marks: ${details.maxMarks}`;
    slide.addText(detailsText, {
        x: 0.5,
        y: 3.0,
        w: '90%',
        h: 0.5,
        fontSize: 18,
        color: '333333',
        align: 'center',
    });
}

function createInstructionsSlide(pptx, data) {
    let slide = pptx.addSlide();
    slide.addText(data.instructions.title, { x: 0.5, y: 0.5, w: '90%', fontSize: 28, bold: true, color: '2B6CB0' });
    
    const instructionPoints = data.instructions.points.map(point => ({ text: point, options: { fontSize: 16, bullet: true, paraSpcAfter: 10 } }));
    
    slide.addText(instructionPoints, {
        x: 0.75,
        y: 1.2,
        w: '85%',
        h: 3.5,
    });
}


function createQuestionSlide(pptx, question, directions = null) {
    let slide = pptx.addSlide();
    const slideTitle = `Question ${question.questionNumber}`;
    slide.addText(slideTitle, { x: 0.5, y: 0.2, w: '90%', h: 0.5, fontSize: 24, bold: true, color: '1A365D' });

    let currentY = 0.8;

    if (directions) {
        // Clean up HTML tags from directions for presentation
        const cleanDirections = directions.text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        slide.addText(`Directions: ${cleanDirections}`, {
            x: 0.5, y: currentY, w: '90%', h: 1.5,
            fontSize: 12, italic: true, color: '555555',
            fill: { color: 'E2E8F0' }, margin: 10
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

    let optionY = currentY > 4 ? 1.2 : currentY; // Reset if text is too long
    let optionX = currentY > 4 ? 5.5 : 0.75;
    let optionW = currentY > 4 ? 4 : '85%';

    question.options.forEach(opt => {
        const optionText = `${opt.label}) ${opt.text || ''}`;
        if (opt.svg) {
            const base64Svg = svgToBase64(opt.svg);
            slide.addText(`${opt.label})`, { x: 0.75, y: optionY, w: 0.5, h: 0.5, fontSize: 14 });
            if (base64Svg) {
                slide.addImage({ data: base64Svg, x: 1.25, y: optionY - 0.25, w: 1, h: 1 });
            }
            optionY += 1.2;
        } else {
            slide.addText(optionText, { x: 0.75, y: optionY, w: '85%', h: 0.3, fontSize: 14 });
            optionY += 0.4;
        }
    });
}

function createAnswerSlide(pptx, question) {
    let slide = pptx.addSlide();
    const slideTitle = `Answer & Solution: Q${question.questionNumber}`;
    slide.addText(slideTitle, { x: 0.5, y: 0.2, w: '90%', h: 0.5, fontSize: 24, bold: true, color: '1A365D' });

    slide.addText(question.solution.answer, {
        x: 0.5, y: 0.8, w: '90%', h: 0.4,
        fontSize: 18, bold: true, color: '008000',
        fill: { color: 'F0FFF0' }
    });

    const explanationText = question.solution.explanation.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    const hasSvg = question.solution.svg && svgToBase64(question.solution.svg);

    slide.addText(explanationText, {
        x: 0.5, y: 1.4, w: hasSvg ? '50%' : '90%', h: 3.8,
        fontSize: 12,
    });

    if (hasSvg) {
        slide.addImage({
            data: svgToBase64(question.solution.svg),
            x: 5.5, y: 1.5, w: 4, h: 3,
        });
    }
}


// --- MAIN SCRIPT ---

async function generatePresentation(inputFilePath) {
    if (!inputFilePath) {
        console.error('Error: Please provide the path to the JSON file.');
        console.log('Usage: node create-ppt.js <path-to-your-json-file.json>');
        process.exit(1);
    }

    try {
        const fullPath = path.resolve(inputFilePath);
        if (!fs.existsSync(fullPath)) {
            console.error(`Error: File not found at ${fullPath}`);
            process.exit(1);
        }

        console.log(`Reading data from ${fullPath}...`);
        const fileContent = fs.readFileSync(fullPath, 'utf-8');
        const jsonData = JSON.parse(fileContent);
        const outputFileName = "Mock_Exam_Presentation.pptx";

        let pptx = new PptxGenJS();

        createTitleSlide(pptx, jsonData);
        createInstructionsSlide(pptx, jsonData);

        const allQuestions = [];
        jsonData.sections.forEach(section => {
            section.questionSets.forEach(qSet => {
                const directions = qSet.type === 'group' ? qSet.directions : null;
                qSet.questions.forEach(q => allQuestions.push({ ...q, directions }));
            });
        });

        console.log('Creating question slides...');
        allQuestions.forEach(q => createQuestionSlide(pptx, q, q.directions));

        let answerTitleSlide = pptx.addSlide();
        answerTitleSlide.background = { color: 'F1F1F1' };
        answerTitleSlide.addText('Answers & Solutions', { x: 0, y: '45%', w: '100%', align: 'center', fontSize: 44, color: '1A365D' });

        console.log('Creating answer slides...');
        allQuestions.forEach(q => createAnswerSlide(pptx, q));

        console.log(`Saving presentation to ${outputFileName}...`);
        await pptx.writeFile({ fileName: outputFileName });
        console.log(`Successfully created ${outputFileName}!`);

    } catch (err) {
        console.error("An error occurred during presentation generation:", err);
        process.exit(1);
    }
}

// Get file path from command-line arguments, which start at index 2
const inputFile = process.argv[2];
generatePresentation(inputFile);
