import { GoogleGenAI } from "@google/genai";
import { program } from "commander";
import * as fs from "fs/promises";
import * as path from "path";
import PptxGenJS from 'pptxgenjs';

// Enhanced system prompt for DI exam generation
const systemPrompt = `You are an expert Data Interpretation (DI) exam designer for competitive entrance exams. Generate a complete DI mock test as valid JSON.

REQUIREMENTS:
1. Focus exclusively on Data Interpretation questions
2. Use realistic business/survey/economic data
3. Include variety: tables, bar charts, pie charts, line graphs
4. Generate 20-25 questions in 4-6 question sets
5. Each set shares common data source

JSON STRUCTURE:
{
  "examTitle": "Data Interpretation Mock Test",
  "examDetails": {
    "totalQuestions": 25,
    "timeAllotted": "60 minutes",
    "maxMarks": 100,
    "examType": "Data Interpretation"
  },
  "instructions": {
    "title": "Instructions",
    "points": [
      "Read all data carefully before answering",
      "Each question carries equal marks",
      "Negative marking: -0.25 for wrong answers",
      "Use approximation where necessary"
    ]
  },
  "sections": [
    {
      "sectionTitle": "Data Interpretation",
      "questionSets": [
        {
          "setNumber": 1,
          "type": "group",
          "directions": {
            "title": "Directions (Q1-Q5)",
            "text": "Study the following data and answer the questions"
          },
          "dataType": "table|chart",
          "tableData": {
            "title": "Sales Data by Region (in Crores)",
            "headers": ["Region", "2021", "2022", "2023"],
            "rows": [
              ["North", "150", "180", "220"],
              ["South", "120", "140", "175"],
              ["East", "100", "115", "130"],
              ["West", "200", "240", "290"]
            ]
          },
          "chartData": {
            "chartType": "bar|column|line|pie|doughnut",
            "title": "Market Share Analysis",
            "data": [
              {
                "name": "Series1",
                "labels": ["Q1", "Q2", "Q3", "Q4"],
                "values": [100, 150, 200, 175]
              }
            ],
            "options": {
              "showLegend": true,
              "showDataLabels": true,
              "colors": ["#2E86AB", "#A23B72", "#F18F01", "#C73E1D"]
            }
          },
          "questions": [
            {
              "questionNumber": "1",
              "questionText": "What is the percentage increase in North region sales from 2021 to 2023?",
              "options": [
                { "label": "A", "text": "46.67%" },
                { "label": "B", "text": "42.50%" },
                { "label": "C", "text": "38.89%" },
                { "label": "D", "text": "52.33%" }
              ],
              "solution": {
                "answer": "A",
                "explanation": "North region sales increased from 150 to 220 crores",
                "calculation": "((220-150)/150) × 100 = 46.67%"
              }
            }
          ]
        }
      ]
    }
  ]
}

Generate complete mock test following this structure.`;

// Chart type mapping for PptxGenJS
const CHART_TYPE_MAP = {
    'bar': 'column',
    'column': 'column',
    'line': 'line',
    'pie': 'pie',
    'doughnut': 'doughnut',
    'area': 'area'
};

// Enhanced API Key Manager
class ApiKeyManager {
    constructor(apiKeys) {
        this.apiKeys = apiKeys.filter(key => key && key.trim().length > 0);
        this.currentIndex = 0;
        this.failedKeys = new Set();
        this.keyUsageCount = new Map();
        
        if (this.apiKeys.length === 0) {
            throw new Error("No valid API keys provided");
        }
        
        console.log(`✅ Loaded ${this.apiKeys.length} API key(s)`);
    }

    getNextKey() {
        if (this.failedKeys.size === this.apiKeys.length) {
            throw new Error("All API keys have failed or reached quota");
        }
        
        let attempts = 0;
        while (this.failedKeys.has(this.currentIndex) && attempts < this.apiKeys.length) {
            this.currentIndex = (this.currentIndex + 1) % this.apiKeys.length;
            attempts++;
        }
        
        if (this.failedKeys.has(this.currentIndex)) {
            throw new Error("No available API keys remaining");
        }
        
        const keyIndex = this.currentIndex;
        const key = this.apiKeys[keyIndex];
        
        // Track usage
        this.keyUsageCount.set(keyIndex, (this.keyUsageCount.get(keyIndex) || 0) + 1);
        
        // Rotate to next key for load balancing
        this.currentIndex = (this.currentIndex + 1) % this.apiKeys.length;
        
        return { key, index: keyIndex };
    }

    markKeyFailed(keyIndex, error) {
        this.failedKeys.add(keyIndex);
        console.warn(`⚠️ API key ${keyIndex + 1} marked as failed: ${error.message}`);
    }

    getStats() {
        const available = this.apiKeys.length - this.failedKeys.size;
        return {
            total: this.apiKeys.length,
            available,
            failed: this.failedKeys.size,
            usage: Object.fromEntries(this.keyUsageCount)
        };
    }
}

// Enhanced file utilities
async function findPdfFiles(dirPath) {
    const pdfFiles = [];
    
    try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        
        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);
            
            if (entry.isDirectory()) {
                const subFiles = await findPdfFiles(fullPath);
                pdfFiles.push(...subFiles);
            } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.pdf') {
                pdfFiles.push(fullPath);
            }
        }
    } catch (error) {
        throw new Error(`Failed to read directory '${dirPath}': ${error.message}`);
    }
    
    return pdfFiles;
}

async function processPdfFiles(filePaths, label) {
    const parts = [];
    const maxFileSize = 20 * 1024 * 1024; // 20MB limit
    let totalSize = 0;
    let processedCount = 0;
    
    for (const filePath of filePaths) {
        try {
            const stats = await fs.stat(filePath);
            
            if (stats.size > maxFileSize) {
                console.warn(`⚠️ Skipping ${path.basename(filePath)} (${(stats.size / 1024 / 1024).toFixed(1)}MB > 20MB limit)`);
                continue;
            }
            
            console.log(`📄 Processing ${label}: ${path.basename(filePath)} (${(stats.size / 1024 / 1024).toFixed(1)}MB)`);
            
            const fileBuffer = await fs.readFile(filePath);
            parts.push({
                inlineData: {
                    mimeType: 'application/pdf',
                    data: fileBuffer.toString('base64'),
                },
            });
            
            totalSize += stats.size;
            processedCount++;
            
        } catch (error) {
            console.error(`❌ Failed to process ${filePath}: ${error.message}`);
        }
    }
    
    console.log(`✅ Processed ${processedCount}/${filePaths.length} ${label} files (${(totalSize / 1024 / 1024).toFixed(1)}MB total)`);
    return parts;
}

// PowerPoint generation utilities
function addSlideWithBackground(pptx, backgroundPath) {
    const slide = pptx.addSlide();
    if (backgroundPath) {
        try {
            slide.background = { path: backgroundPath };
        } catch (error) {
            console.warn(`⚠️ Failed to set background image: ${error.message}`);
        }
    }
    return slide;
}

function createChart(slide, chartData, position = {}) {
    if (!chartData || typeof chartData !== 'object') {
        console.warn("⚠️ Skipping chart: No chart data provided");
        return false;
    }

    const { chartType, title, data, options = {} } = chartData;
    
    if (!chartType || !data || !Array.isArray(data) || data.length === 0) {
        console.warn("⚠️ Skipping chart: Missing chartType or data array");
        return false;
    }

    const pos = { x: 1, y: 2, w: 8, h: 4, ...position };

    try {
        let chartDataArray = [];
        const pptxChartType = CHART_TYPE_MAP[chartType] || 'column';

        if (chartType === 'pie' || chartType === 'doughnut') {
            // Pie chart format
            const series = data[0] || {};
            const labels = series.labels || [];
            const values = series.values || [];

            if (labels.length === 0 || values.length === 0) {
                console.warn("⚠️ Pie chart: No labels or values found");
                return false;
            }

            chartDataArray = labels.map((label, index) => ({
                name: String(label || `Item ${index + 1}`),
                value: Number(values[index]) || 0
            }));
        } else {
            // Bar/Line/Column chart format
            const firstSeries = data[0] || {};
            const categories = firstSeries.labels || [];
            
            if (categories.length === 0) {
                console.warn("⚠️ Chart: No categories found");
                return false;
            }

            chartDataArray = categories.map(category => {
                const dataPoint = { name: String(category) };
                
                data.forEach((series, index) => {
                    const seriesName = series.name || `Series${index + 1}`;
                    const seriesLabels = series.labels || [];
                    const seriesValues = series.values || [];
                    const categoryIndex = seriesLabels.indexOf(category);
                    
                    dataPoint[seriesName] = categoryIndex >= 0 ? 
                        (Number(seriesValues[categoryIndex]) || 0) : 0;
                });
                
                return dataPoint;
            });
        }

        if (chartDataArray.length === 0) {
            console.warn("⚠️ No valid chart data points generated");
            return false;
        }

        const chartConfig = {
            x: pos.x,
            y: pos.y,
            w: pos.w,
            h: pos.h,
            showTitle: Boolean(title),
            title: title || '',
            showLegend: options.showLegend !== false,
            showValue: options.showDataLabels !== false,
            ...((chartType === 'doughnut') && { hole: 0.4 })
        };

        slide.addChart(pptxChartType, chartDataArray, chartConfig);
        console.log(`✅ Created ${chartType} chart with ${chartDataArray.length} data points`);
        return true;
        
    } catch (error) {
        console.error(`❌ Error creating ${chartType} chart: ${error.message}`);
        return false;
    }
}

function createTable(slide, tableData, position = {}) {
    if (!tableData || typeof tableData !== 'object') {
        console.warn("⚠️ Skipping table: No table data provided");
        return false;
    }

    const { title, headers, rows } = tableData;
    
    if (!headers || !Array.isArray(headers) || headers.length === 0) {
        console.warn("⚠️ Skipping table: Missing or invalid headers");
        return false;
    }
    
    if (!rows || !Array.isArray(rows) || rows.length === 0) {
        console.warn("⚠️ Skipping table: Missing or invalid rows");
        return false;
    }

    const pos = { x: 0.5, y: 2, w: 9, h: 4, ...position };

    try {
        // Prepare table data - ensure all cells are strings
        const tableRows = [
            headers.map(header => String(header || '')),
            ...rows.map(row => 
                Array.isArray(row) ? 
                row.map(cell => String(cell || '')) : 
                [String(row || '')]
            )
        ];

        if (tableRows.length <= 1) {
            console.warn("⚠️ Table has no data rows");
            return false;
        }

        // Calculate dimensions
        const maxCols = Math.max(...tableRows.map(row => row.length));
        const colWidth = pos.w / maxCols;
        const rowHeight = Math.min(0.4, pos.h / tableRows.length);

        // Ensure all rows have same number of columns
        const normalizedRows = tableRows.map(row => {
            const normalizedRow = [...row];
            while (normalizedRow.length < maxCols) {
                normalizedRow.push('');
            }
            return normalizedRow;
        });

        const tableConfig = {
            x: pos.x,
            y: pos.y,
            w: pos.w,
            h: pos.h,
            border: { type: "solid", pt: 1, color: "1A365D" },
            fill: { color: "F8FAFC" },
            color: "1E293B",
            fontSize: 11,
            align: "center",
            valign: "middle",
            colW: Array(maxCols).fill(colWidth),
            rowH: Array(normalizedRows.length).fill(rowHeight)
        };

        slide.addTable(normalizedRows, tableConfig);

        // Add title if provided
        if (title && title.trim()) {
            slide.addText(title.trim(), {
                x: pos.x,
                y: pos.y - 0.4,
                w: pos.w,
                h: 0.3,
                fontSize: 14,
                bold: true,
                color: "1A365D",
                align: "center"
            });
        }

        console.log(`✅ Created table with ${normalizedRows.length - 1} data rows and ${maxCols} columns`);
        return true;
        
    } catch (error) {
        console.error(`❌ Error creating table: ${error.message}`);
        console.error(`Table data structure:`, JSON.stringify(tableData, null, 2));
        return false;
    }
}

// PowerPoint slide creation functions
function createTitleSlide(pptx, examData, backgroundPath) {
    const slide = addSlideWithBackground(pptx, backgroundPath);
    
    slide.addText(examData.examTitle || 'Data Interpretation Mock Test', {
        x: 0.5, y: 2, w: '90%', h: 1,
        fontSize: 36, bold: true, color: '003B75', align: 'center'
    });
    
    const details = examData.examDetails || {};
    const detailsText = [
        details.totalQuestions && `Questions: ${details.totalQuestions}`,
        details.timeAllotted && `Time: ${details.timeAllotted}`,
        details.maxMarks && `Marks: ${details.maxMarks}`
    ].filter(Boolean).join(' | ');
    
    if (detailsText) {
        slide.addText(detailsText, {
            x: 0.5, y: 3.2, w: '90%', h: 0.5,
            fontSize: 18, color: '4A5568', align: 'center'
        });
    }
    
    slide.addText('Mock Test for Competitive Exams', {
        x: 0.5, y: 4, w: '90%', h: 0.4,
        fontSize: 16, color: '718096', align: 'center', italic: true
    });
}

function createInstructionsSlide(pptx, examData, backgroundPath) {
    const slide = addSlideWithBackground(pptx, backgroundPath);
    
    const instructions = examData.instructions || {};
    slide.addText(instructions.title || 'Instructions', {
        x: 0.5, y: 0.7, w: '90%', h: 0.6,
        fontSize: 28, bold: true, color: '2B6CB0', align: 'center'
    });
    
    let currentY = 1.5;
    const points = instructions.points || [
        'Read all data carefully before answering',
        'Each question carries equal marks',
        'There may be negative marking for incorrect answers',
        'Use approximation where necessary'
    ];
    
    points.forEach(point => {
        slide.addText(`• ${point}`, {
            x: 1, y: currentY, w: '85%', h: 0.4,
            fontSize: 16, color: '2D3748'
        });
        currentY += 0.5;
    });
}

function createDataSlide(pptx, questionSet, backgroundPath) {
    const slide = addSlideWithBackground(pptx, backgroundPath);
    
    const setNumber = questionSet.setNumber || 1;
    slide.addText(`Data Set ${setNumber}`, {
        x: 0.5, y: 0.3, w: '90%', h: 0.5,
        fontSize: 24, bold: true, color: '1A365D', align: 'center'
    });

    // Add directions
    const directions = questionSet.directions || {};
    if (directions.text) {
        slide.addText(directions.text, {
            x: 0.5, y: 0.9, w: '90%', h: 0.4,
            fontSize: 14, color: '4A5568', align: 'center'
        });
    }

    let hasData = false;

    // Add chart if present
    if (questionSet.chartData) {
        hasData = createChart(slide, questionSet.chartData, { x: 1, y: 1.5, w: 8, h: 4 });
    }

    // Add table if present (and no chart, or position differently)
    if (questionSet.tableData) {
        const tablePos = hasData ? { x: 0.5, y: 6, w: 9, h: 2.5 } : { x: 0.5, y: 1.5, w: 9, h: 4 };
        createTable(slide, questionSet.tableData, tablePos);
        hasData = true;
    }

    if (!hasData) {
        slide.addText('No data visualization available for this set', {
            x: 0.5, y: 3, w: '90%', h: 0.5,
            fontSize: 16, color: 'CC0000', align: 'center', italic: true
        });
    }
}


function createQuestionsSlide(pptx, questionSet, backgroundPath) {
    const slide = addSlideWithBackground(pptx, backgroundPath);

    const setNumber = questionSet.setNumber || 1;
    const directions = questionSet.directions || {};

    slide.addText(directions.title || `Questions - Set ${setNumber}`, {
        x: 0.5, y: 0.3, w: '90%', h: 0.5,
        fontSize: 22, bold: true, color: '1A365D', align: 'center'
    });

    let currentY = 1;
    const questions = questionSet.questions || [];

    // Safety check - ensure questions is actually an array
    if (!Array.isArray(questions) || questions.length === 0) {
        slide.addText('No questions available for this set', {
            x: 0.5, y: 3, w: '90%', h: 0.5,
            fontSize: 16, color: 'CC0000', align: 'center', italic: true
        });
        return;
    }

    questions.forEach((question, index) => {
        if (currentY > 6.5) return; // Prevent overflow

        // Safety check for question object
        if (!question || typeof question !== 'object') return;

        // Question text
        const qNumber = question.questionNumber || (index + 1);
        const questionText = question.questionText || 'Question text missing';

        slide.addText(`Q${qNumber}. ${questionText}`, {
            x: 0.5, y: currentY, w: '90%', h: 0.4,
            fontSize: 13, bold: true, color: '2D3748'
        });
        currentY += 0.5;

        // Handle options (regular questions)
        if (question.options && Array.isArray(question.options)) {
            question.options.forEach(option => {
                if (currentY > 7) return;

                // Safety check for option object
                if (!option || typeof option !== 'object') return;

                const label = option.label || '•';
                const text = option.text || 'Option text missing';

                slide.addText(`${label}) ${text}`, {
                    x: 0.8, y: currentY, w: '85%', h: 0.25,
                    fontSize: 11, color: '4A5568'
                });
                currentY += 0.3;
            });
        }

        // Handle statements (data sufficiency questions)
        if (question.statements && Array.isArray(question.statements)) {
            question.statements.forEach((statement, stmtIndex) => {
                if (currentY > 7) return;

                const stmtLabel = stmtIndex === 0 ? 'I' : 'II';
                slide.addText(`Statement ${stmtLabel}: ${statement}`, {
                    x: 0.8, y: currentY, w: '85%', h: 0.3,
                    fontSize: 11, color: '4A5568', italic: true
                });
                currentY += 0.35;
            });

            // Add options after statements for data sufficiency questions
            if (question.options && Array.isArray(question.options)) {
                question.options.forEach(option => {
                    if (currentY > 7) return;

                    if (!option || typeof option !== 'object') return;

                    const label = option.label || '•';
                    const text = option.text || 'Option text missing';

                    slide.addText(`${label}) ${text}`, {
                        x: 0.8, y: currentY, w: '85%', h: 0.25,
                        fontSize: 11, color: '4A5568'
                    });
                    currentY += 0.3;
                });
            }
        }

        currentY += 0.2;
    });
}

function createAnswersSlide(pptx, questionSet, backgroundPath) {
    const slide = addSlideWithBackground(pptx, backgroundPath);
    
    const setNumber = questionSet.setNumber || 1;
    slide.addText(`Answers & Solutions - Set ${setNumber}`, {
        x: 0.5, y: 0.3, w: '90%', h: 0.5,
        fontSize: 22, bold: true, color: '1A365D', align: 'center'
    });

    let currentY = 1;
    const questions = questionSet.questions || [];
    
    if (questions.length === 0) {
        slide.addText('No answers available for this set', {
            x: 0.5, y: 3, w: '90%', h: 0.5,
            fontSize: 16, color: 'CC0000', align: 'center', italic: true
        });
        return;
    }
    
    questions.forEach((question, index) => {
        if (currentY > 6.5) return;
        
        const qNumber = question.questionNumber || (index + 1);
        const solution = question.solution || {};
        
        // Answer
        const answer = solution.answer || 'N/A';
        slide.addText(`Q${qNumber}: ${answer}`, {
            x: 0.5, y: currentY, w: '90%', h: 0.3,
            fontSize: 14, bold: true, color: '38A169'
        });
        currentY += 0.4;

        // Explanation
        const explanation = solution.explanation || 'No explanation provided';
        const calculation = solution.calculation ? `\nCalculation: ${solution.calculation}` : '';
        const fullText = explanation + calculation;
        
        if (fullText.trim()) {
            slide.addText(fullText, {
                x: 0.5, y: currentY, w: '90%', h: 0.6,
                fontSize: 10, color: '2F855A'
            });
            currentY += 0.8;
        }
    });
}

// Main PowerPoint generation function
async function generatePowerPoint(examData, outputPath, backgroundPath = null) {
    try {
        console.log('🎯 Creating PowerPoint presentation...');
        
        // Debug: Log the exam data structure
        console.log('📋 Exam data structure:');
        console.log(`   Title: ${examData.examTitle || 'N/A'}`);
        console.log(`   Sections: ${examData.sections?.length || 0}`);
        
        if (examData.sections) {
            examData.sections.forEach((section, sIndex) => {
                console.log(`   Section ${sIndex + 1}: ${section.sectionTitle || 'Unnamed'}`);
                console.log(`     Question Sets: ${section.questionSets?.length || 0}`);
                
                if (section.questionSets) {
                    section.questionSets.forEach((qSet, qIndex) => {
                        console.log(`       Set ${qIndex + 1}: ${qSet.questions?.length || 0} questions`);
                        console.log(`         Has chartData: ${!!qSet.chartData}`);
                        console.log(`         Has tableData: ${!!qSet.tableData}`);
                    });
                }
            });
        }
        
        const pptx = new PptxGenJS();
        
        // Create title and instructions slides
        createTitleSlide(pptx, examData, backgroundPath);
        createInstructionsSlide(pptx, examData, backgroundPath);

        // Process question sets
        const sections = examData.sections || [];
        let totalSets = 0;
        
        if (sections.length === 0) {
            throw new Error("No sections found in exam data");
        }
        
        for (const [sectionIndex, section] of sections.entries()) {
            console.log(`📚 Processing section ${sectionIndex + 1}: ${section.sectionTitle || 'Unnamed'}`);
            
            const questionSets = section.questionSets || [];
            
            if (questionSets.length === 0) {
                console.warn(`⚠️ Section ${sectionIndex + 1} has no question sets`);
                continue;
            }
            
            for (const [setIndex, questionSet] of questionSets.entries()) {
                const setNumber = totalSets + 1;
                console.log(`📝 Processing question set ${setNumber}`);
                
                const processedQuestionSet = { 
                    ...questionSet, 
                    setNumber: setNumber 
                };
                
                try {
                    // Create data slide
                    createDataSlide(pptx, processedQuestionSet, backgroundPath);
                    
                    // Create questions slide
                    createQuestionsSlide(pptx, processedQuestionSet, backgroundPath);
                    
                    totalSets++;
                    console.log(`✅ Question set ${setNumber} processed successfully`);
                    
                } catch (setError) {
                    console.error(`❌ Error processing question set ${setNumber}: ${setError.message}`);
                    console.error(`Question set data:`, JSON.stringify(questionSet, null, 2));
                    throw setError;
                }
            }
        }

        if (totalSets === 0) {
            throw new Error("No question sets were processed successfully");
        }

        // Add separator slide for answers
        const separatorSlide = addSlideWithBackground(pptx, backgroundPath);
        separatorSlide.addText('Answers & Solutions', {
            x: 0, y: '45%', w: '100%', h: 1,
            align: 'center', fontSize: 40, color: '003B75', bold: true
        });

        // Create answer slides
        console.log('📋 Creating answer slides...');
        for (const [sectionIndex, section] of sections.entries()) {
            const questionSets = section.questionSets || [];
            
            for (const [setIndex, questionSet] of questionSets.entries()) {
                const setNumber = setIndex + 1;
                const processedQuestionSet = { 
                    ...questionSet, 
                    setNumber: setNumber 
                };
                
                try {
                    createAnswersSlide(pptx, processedQuestionSet, backgroundPath);
                } catch (answerError) {
                    console.error(`❌ Error creating answer slide for set ${setNumber}: ${answerError.message}`);
                    // Continue with other slides
                }
            }
        }

        // Ensure output directory exists
        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        
        // Save presentation
        console.log('💾 Saving PowerPoint file...');
        await pptx.writeFile({ fileName: outputPath });
        console.log(`✅ PowerPoint generated: ${path.basename(outputPath)} (${totalSets} sets)`);
        
        return { success: true, outputPath, totalSets };
        
    } catch (error) {
        console.error(`❌ PowerPoint generation failed: ${error.message}`);
        console.error(`Stack trace:`, error.stack);
        
        // Log the exam data structure for debugging
        if (examData) {
            console.error('📋 Debug - Exam data structure:');
            try {
                console.error(JSON.stringify(examData, null, 2));
            } catch (jsonError) {
                console.error('Could not stringify exam data:', jsonError.message);
            }
        }
        
        throw error;
    }
}

// JSON parsing and validation
function parseAndValidateJson(responseText) {
    if (!responseText || typeof responseText !== 'string') {
        throw new Error("Empty or invalid response from API");
    }

    // Clean JSON response
    let cleanJson = responseText.trim();
    
    // Remove code block markers
    if (cleanJson.startsWith('```json')) {
        cleanJson = cleanJson.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (cleanJson.startsWith('```')) {
        cleanJson = cleanJson.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }

    // Remove control characters
    cleanJson = cleanJson.replace(/[\u0000-\u001F\u007F]/g, '');
    
    // Fix common JSON issues
    cleanJson = cleanJson.replace(/,\s*([\]}])/g, '$1'); // Remove trailing commas

    try {
        const jsonData = JSON.parse(cleanJson);
        
        // Validate basic structure
        if (!jsonData || typeof jsonData !== 'object') {
            throw new Error("Parsed data is not a valid object");
        }
        
        if (!jsonData.sections || !Array.isArray(jsonData.sections)) {
            throw new Error("Missing or invalid 'sections' array in JSON");
        }
        
        if (jsonData.sections.length === 0) {
            throw new Error("No sections found in exam data");
        }
        
        // Validate question sets
        let totalQuestions = 0;
        for (const section of jsonData.sections) {
            if (!section.questionSets || !Array.isArray(section.questionSets)) {
                throw new Error("Missing or invalid 'questionSets' in section");
            }
            
            for (const questionSet of section.questionSets) {
                if (!questionSet.questions || !Array.isArray(questionSet.questions)) {
                    throw new Error("Missing or invalid 'questions' in question set");
                }
                totalQuestions += questionSet.questions.length;
            }
        }
        
        if (totalQuestions === 0) {
            throw new Error("No questions found in exam data");
        }
        
        console.log(`✅ JSON validated: ${totalQuestions} questions in ${jsonData.sections.length} section(s)`);
        return jsonData;
        
    } catch (parseError) {
        console.error("❌ JSON Parse Error:", parseError.message);
        console.error("📄 JSON snippet (first 500 chars):", cleanJson.substring(0, 500));
        throw new Error(`Failed to parse JSON response: ${parseError.message}`);
    }
}

// Mock test generation with retry logic
async function generateMockTest(contents, outputPath, mockNumber, totalMocks, apiKeyManager, options = {}) {
    const maxRetries = 3;
    const retryDelay = 1000; // Base delay in ms
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const keyInfo = apiKeyManager.getNextKey();
            const genAI = new GoogleGenAI({ apiKey: keyInfo.key });
            
            console.log(`🔄 Mock ${mockNumber}/${totalMocks} - Attempt ${attempt}/${maxRetries} (API Key ${keyInfo.index + 1})`);
            
            const generationConfig = {
                maxOutputTokens: options.maxTokens || 8192,
                temperature: options.temperature || 0.7,
                topP: options.topP || 0.9,
                topK: options.topK || 40
            };
            
            // Make API call using the correct method from your original code
            const response = await genAI.models.generateContent({
                model: options.model || "gemini-2.0-flash-exp",
                contents: contents,
                generationConfig: generationConfig
            });
            
            if (!response?.text) {
                throw new Error("No response from API");
            }

            const responseText = response.text;

            // Parse and validate JSON
            const examData = parseAndValidateJson(responseText);
            
            // Additional debug logging
            console.log('🔍 Parsed exam data preview:');
            console.log(`   Exam Title: ${examData.examTitle}`);
            console.log(`   Sections count: ${examData.sections?.length}`);
            console.log(`   First section: ${examData.sections?.[0]?.sectionTitle}`);
            console.log(`   First question set: ${examData.sections?.[0]?.questionSets?.length} sets`);
            
            // Generate PowerPoint
            const backgroundPath = options.pptBackground || null;
            const pptResult = await generatePowerPoint(examData, outputPath, backgroundPath);
            
            console.log(`✅ Mock ${mockNumber}/${totalMocks} completed successfully`);
            
            return {
                success: true,
                outputPath,
                mockNumber,
                examData,
                pptResult
            };

        } catch (error) {
            const isQuotaError = error.message.toLowerCase().includes('quota') || 
                               error.message.toLowerCase().includes('resource_exhausted') ||
                               error.message.toLowerCase().includes('rate limit');
                               
            if (isQuotaError && apiKeyManager.currentIndex !== undefined) {
                apiKeyManager.markKeyFailed(apiKeyManager.currentIndex, error);
            }
            
            console.error(`❌ Mock ${mockNumber} - Attempt ${attempt} failed: ${error.message}`);
            
            if (attempt === maxRetries) {
                return {
                    success: false,
                    error,
                    outputPath,
                    mockNumber
                };
            }
            
            // Exponential backoff
            const delay = retryDelay * Math.pow(2, attempt - 1);
            console.log(`⏳ Retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

// Main application logic
async function main() {
    program
        .name('di-mock-generator')
        .description('Generate Data Interpretation mock tests from PDFs')
        .version('2.0.0')
        .requiredOption('--pyq <directory>', 'Directory containing PYQ PDF files')
        .requiredOption('--reference-mock <directory>', 'Directory containing reference mock PDF files') 
        .requiredOption('-o, --output <filename>', 'Output filename (.pptx) or base name for multiple mocks')
        .requiredOption('--prompt <file>', 'User prompt/instructions file')
        .option('--api-key-file <file>', 'File containing API keys (one per line)', 'api_key.txt')
        .option('--number-of-mocks <number>', 'Number of mock tests to generate', (value) => {
            const parsed = parseInt(value, 10);
            if (isNaN(parsed) || parsed < 1) {
                throw new Error(`Invalid number of mocks: ${value}. Must be a positive integer.`);
            }
            return parsed;
        }, 1)
        .option('--model <model>', 'Gemini model to use', 'gemini-2.0-flash-exp')
        .option('--max-tokens <number>', 'Maximum output tokens', (value) => {
            const parsed = parseInt(value, 10);
            if (isNaN(parsed) || parsed < 1000) {
                throw new Error(`Invalid max tokens: ${value}. Must be at least 1000.`);
            }
            return parsed;
        }, 8192)
        .option('--temperature <number>', 'Temperature for generation', (value) => {
            const parsed = parseFloat(value);
            if (isNaN(parsed) || parsed < 0 || parsed > 2) {
                throw new Error(`Invalid temperature: ${value}. Must be between 0 and 2.`);
            }
            return parsed;
        }, 0.7)
        .option('--top-p <number>', 'Top-p for generation', (value) => {
            const parsed = parseFloat(value);
            if (isNaN(parsed) || parsed < 0 || parsed > 1) {
                throw new Error(`Invalid top-p: ${value}. Must be between 0 and 1.`);
            }
            return parsed;
        }, 0.9)
        .option('--top-k <number>', 'Top-k for generation', (value) => {
            const parsed = parseInt(value, 10);
            if (isNaN(parsed) || parsed < 1) {
                throw new Error(`Invalid top-k: ${value}. Must be a positive integer.`);
            }
            return parsed;
        }, 40)
        .option('--ppt-background <file>', 'Background image for PowerPoint slides')
        .option('--delay <number>', 'Delay between requests (ms)', (value) => {
            const parsed = parseInt(value, 10);
            if (isNaN(parsed) || parsed < 0) {
                throw new Error(`Invalid delay: ${value}. Must be a non-negative integer.`);
            }
            return parsed;
        }, 1000)
        .parse();

    const options = program.opts();

    try {
        console.log('🚀 DI Mock Test Generator v2.0.0');
        console.log('=====================================');
        
        // Debug: Log parsed options
        console.log('🔧 Configuration:');
        console.log(`   📁 PYQ Directory: ${options.pyq}`);
        console.log(`   📁 Reference Mock Directory: ${options.referenceMock}`);
        console.log(`   📄 Output: ${options.output}`);
        console.log(`   📝 Prompt File: ${options.prompt}`);
        console.log(`   🔑 API Key File: ${options.apiKeyFile}`);
        console.log(`   🔢 Number of Mocks: ${options.numberOfMocks}`);
        console.log(`   🤖 Model: ${options.model}`);
        console.log(`   🎯 Max Tokens: ${options.maxTokens}`);
        console.log(`   🌡️ Temperature: ${options.temperature}`);
        console.log('');
        
        // Validate input directories
        console.log('📂 Validating input directories...');
        await fs.access(options.pyq);
        await fs.access(options.referenceMock);
        console.log('✅ Input directories validated');
        
        // Load and validate API keys
        console.log('🔑 Loading API keys...');
        const apiKeyContent = await fs.readFile(options.apiKeyFile, 'utf-8');
        const apiKeys = apiKeyContent
            .split('\n')
            .map(key => key.trim())
            .filter(key => key.length > 0);
            
        const apiKeyManager = new ApiKeyManager(apiKeys);

        // Load user prompt
        console.log('📝 Loading user prompt...');
        const userPrompt = await fs.readFile(options.prompt, 'utf-8');
        if (!userPrompt.trim()) {
            throw new Error("Prompt file is empty");
        }
        console.log(`✅ Loaded prompt (${userPrompt.length} characters)`);

        // Find and process PDF files
        console.log('📄 Processing PDF files...');
        const pyqFiles = await findPdfFiles(options.pyq);
        const refMockFiles = await findPdfFiles(options.referenceMock);
        
        if (pyqFiles.length === 0) {
            throw new Error(`No PDF files found in PYQ directory: ${options.pyq}`);
        }
        
        if (refMockFiles.length === 0) {
            throw new Error(`No PDF files found in reference mock directory: ${options.referenceMock}`);
        }
        
        console.log(`📚 Found ${pyqFiles.length} PYQ file(s) and ${refMockFiles.length} reference mock file(s)`);
        
        // Convert PDFs to API parts
        const pyqParts = await processPdfFiles(pyqFiles, "PYQ");
        const refMockParts = await processPdfFiles(refMockFiles, "Reference Mock");

        // Build content for API
        const contents = [
            { text: SYSTEM_PROMPT_DI },
            { text: "\n--- REFERENCE PYQ FILES ---" },
            ...pyqParts,
            { text: "\n--- REFERENCE MOCK TEST FILES ---" },
            ...refMockParts,
            { text: "\n--- USER INSTRUCTIONS ---" },
            { text: userPrompt },
            { text: "\nGenerate a complete DI mock test following the JSON structure specified above." }
        ];

        console.log(`📊 Prepared ${contents.length} content parts for API`);

        // Validate output path and prepare for multiple mocks
        const numberOfMocks = Math.max(1, options.numberOfMocks || 1);
        
        if (isNaN(numberOfMocks) || numberOfMocks < 1) {
            throw new Error(`Invalid number of mocks: ${options.numberOfMocks}. Must be a positive integer.`);
        }
        
        console.log(`🎯 Configured to generate ${numberOfMocks} mock test(s)`);
        
        const outputPaths = [];
        
        if (numberOfMocks === 1) {
            outputPaths.push(options.output);
        } else {
            const basePath = options.output.replace(/\.pptx$/i, '');
            for (let i = 1; i <= numberOfMocks; i++) {
                outputPaths.push(`${basePath}_${String(i).padStart(2, '0')}.pptx`);
            }
        }

        // Validate background image if provided
        if (options.pptBackground) {
            try {
                await fs.access(options.pptBackground);
                console.log(`🖼️ Background image validated: ${path.basename(options.pptBackground)}`);
            } catch {
                console.warn(`⚠️ Background image not found, proceeding without: ${options.pptBackground}`);
                options.pptBackground = null;
            }
        }

        // Generate mock tests
        console.log(`\n🎯 Generating ${numberOfMocks} mock test(s)...`);
        console.log('=====================================');
        
        const startTime = Date.now();
        const results = [];
        
        for (let i = 0; i < numberOfMocks; i++) {
            const mockNumber = i + 1;
            const outputPath = outputPaths[i];
            
            console.log(`\n📝 Starting mock ${mockNumber}/${numberOfMocks}...`);
            
            const result = await generateMockTest(
                contents, 
                outputPath, 
                mockNumber, 
                numberOfMocks, 
                apiKeyManager, 
                {
                    model: options.model,
                    maxTokens: options.maxTokens,
                    temperature: options.temperature,
                    topP: options.topP,
                    topK: options.topK,
                    pptBackground: options.pptBackground
                }
            );
            
            results.push(result);
            
            // Add delay between requests if multiple mocks
            if (numberOfMocks > 1 && i < numberOfMocks - 1 && options.delay > 0) {
                console.log(`⏳ Waiting ${options.delay}ms before next request...`);
                await new Promise(resolve => setTimeout(resolve, options.delay));
            }
        }
        
        const endTime = Date.now();
        const totalTime = ((endTime - startTime) / 1000).toFixed(2);
        
        // Generate summary
        const successful = results.filter(r => r.success);
        const failed = results.filter(r => !r.success);
        
        console.log('\n📊 GENERATION SUMMARY');
        console.log('=====================================');
        console.log(`✅ Successful: ${successful.length}/${numberOfMocks}`);
        console.log(`❌ Failed: ${failed.length}/${numberOfMocks}`);
        console.log(`⏱️ Total time: ${totalTime} seconds`);
        console.log(`🔑 API key stats:`, apiKeyManager.getStats());
        
        if (successful.length > 0) {
            console.log('\n📁 Generated Files:');
            successful.forEach((result, index) => {
                const fileSize = (() => {
                    try {
                        const stats = require('fs').statSync(result.outputPath);
                        return `(${(stats.size / 1024 / 1024).toFixed(1)}MB)`;
                    } catch {
                        return '';
                    }
                })();
                
                console.log(`${index + 1}. ${path.basename(result.outputPath)} ${fileSize}`);
                if (result.pptResult?.totalSets) {
                    console.log(`   └── ${result.pptResult.totalSets} question sets`);
                }
            });
        }

        if (failed.length > 0) {
            console.log('\n❌ Failed Generations:');
            failed.forEach((result, index) => {
                console.log(`${index + 1}. ${path.basename(result.outputPath)}`);
                console.log(`   └── Error: ${result.error.message}`);
            });
        }
        
        // Performance metrics
        if (successful.length > 0) {
            const avgTimePerMock = (parseFloat(totalTime) / successful.length).toFixed(2);
            console.log(`\n📈 Performance: ${avgTimePerMock}s per successful mock`);
        }
        
        console.log('\n🎉 Generation process completed!');
        
        // Exit with appropriate code
        process.exit(failed.length > 0 ? 1 : 0);
        
    } catch (error) {
        console.error('\n💥 FATAL ERROR');
        console.error('=====================================');
        console.error(`❌ ${error.message}`);
        
        if (error.stack && process.env.DEBUG) {
            console.error('\n🔍 Stack Trace:');
            console.error(error.stack);
        }
        
        console.error('\n💡 Troubleshooting Tips:');
        console.error('• Check that all file paths are correct');
        console.error('• Ensure API key file contains valid keys');
        console.error('• Verify PDF files are not corrupted');
        console.error('• Make sure you have write permissions to output directory');
        console.error('• Try reducing the number of mocks or file sizes');
        
        process.exit(1);
    }
}

// Enhanced error handling
process.on('unhandledRejection', (reason, promise) => {
    console.error('\n💥 Unhandled Promise Rejection');
    console.error('Promise:', promise);
    console.error('Reason:', reason);
    process.exit(1);
});

process.on('uncaughtException', (error) => {
    console.error('\n💥 Uncaught Exception');
    console.error('Error:', error);
    console.error('Stack:', error.stack);
    process.exit(1);
});

// Graceful shutdown handling
process.on('SIGINT', () => {
    console.log('\n\n🛑 Received SIGINT. Shutting down gracefully...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n\n🛑 Received SIGTERM. Shutting down gracefully...');
    process.exit(0);
});

// Run the application
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(error => {
        console.error('\n💥 Application crashed:', error.message);
        process.exit(1);
    });
}

export {
    ApiKeyManager,
    generateMockTest,
    generatePowerPoint,
    parseAndValidateJson,
    findPdfFiles,
    processPdfFiles
};
