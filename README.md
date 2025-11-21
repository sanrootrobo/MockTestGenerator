

🚀 Gemini AI Mock Test Generator
The Ultimate Automated Exam Creation Tool

📖 Overview

The Gemini AI Mock Test Generator is a powerful automation tool designed for EdTech platforms, educators, and developers. It utilizes advanced LLMs  to analyze your existing "Previous Year Questions" (PYQs) and "Reference Mocks."

By understanding the pattern, difficulty, and style of your input files, it generates brand new, plagiarism-free questions complete with detailed solutions and vector diagrams (SVG). The output is instantly formatted into printable PDFs, editable PowerPoint (PPTX) slides, and structured JSON for database integration.

✨ Key Features
🧠 Context-Aware AI Generation

Style Mimicry: Analyzes input PDFs to replicate the exact tone and difficulty of the target exam.

Multi-Modal Thinking: Generates text and SVG diagrams for geometry, logical reasoning, and data interpretation.

Reasoning Models: Full support for Gemini Thinking Models with configurable token budgets for complex problem solving.

📦 Professional Output Formats

Print-Ready PDFs: Uses Puppeteer to render beautifully styled, academy-grade exam papers.

Presentation Slides: Automatically generates PowerPoint (.pptx) files for classroom projection or video explanations.

JSON Data: Exports raw JSON for easy integration with LMS (Learning Management Systems) or mobile apps.

⚙️ Enterprise-Grade Architecture

Smart Rate Limiting: Built-in handling for API quotas and delays.

Key Rotation: Supports multiple API keys with auto-switching and failure handling for high-volume generation.

Concurrency: Generate 10, 50, or 100 mocks simultaneously with parallel processing.

🛠️ Installation

Ensure you have Node.js (v18 or higher) installed.

Clone the repository:

code
Bash
download
content_copy
expand_less
git clone https://github.com/yourusername/ai-mock-test-generator.git
cd ai-mock-test-generator

Install dependencies:

code
Bash
download
content_copy
expand_less
npm install @google/genai commander puppeteer pptxgenjs

Configure API Keys:
Create a file named api_key.txt in the root directory. Paste your Google GenAI API keys (one per line).

🚀 Quick Start

Organize your data:

/pyqs: Folder containing past exam PDFs.

/refs: Folder containing reference mock PDFs.

prompt.txt: A text file with your specific requirements (e.g., "Create a 30-question Physics test on Kinematics").

Run the generator:

code
Bash
download
content_copy
expand_less
node script.js --pyq ./pyqs --reference-mock ./refs --prompt prompt.txt --output ./results/mock_test
🎛️ Advanced Usage & CLI Options

Customize your generation engine with these flags:

Option	Description	Default
--output, -o	Base filename for generated files.	Required
--number-of-mocks	How many unique tests to generate.	1
--ppt	Enable PowerPoint (.pptx) output.	Disabled
--ppt-background	Custom background image path for slides.	null
--model	Specific Gemini model (e.g., gemini-2.0-flash-thinking-exp).	gemini-2.5-flash
--thinking-budget	Token budget for reasoning (Pro/Flash models). -1 for dynamic.	null
--concurrent-limit	Max parallel generations for speed.	3
--save-json	Save raw JSON for debugging/API use.	Disabled
Example: High-Volume Production Run

Generate 10 unique Logical Reasoning tests with PowerPoint slides, using the "Thinking" model for deeper logic:

code
Bash
download
content_copy
expand_less
node script.js \
  --pyq ./data/cat_exam_pyq \
  --reference-mock ./data/coaching_mocks \
  --prompt ./instructions/lr_hard.txt \
  --output ./production/batch_01/test \
  --number-of-mocks 10 \
  --concurrent-limit 5 \
  --ppt \
  --ppt-background ./assets/brand_bg.jpg \
  --model gemini-2.0-flash-thinking-exp \
  --thinking-budget 4096
🎯 Use Cases

EdTech Startups: Automatically scale your content library from 10 tests to 1000 tests overnight.

Coaching Institutes: Create personalized homework sheets based on previous year patterns.

Content Creators: Generate content for "Mock Test Solving" YouTube videos (using the PPTX output).

Developers: Use the JSON output to populate Quiz Apps or websites.



License

This project is licensed under the GPL-3.0 License - see the LICENSE file for details.

