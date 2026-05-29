document.addEventListener('DOMContentLoaded', () => {
  /* --- Theming --- */
  const html = document.documentElement;
  const themeToggle = document.getElementById('theme-toggle');

  // Set initial theme based on system preference
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    html.classList.add('dark');
  }

  themeToggle.addEventListener('click', () => {
    html.classList.toggle('dark');
  });

  /* --- DOM Elements --- */
  const uploadZone = document.getElementById('upload-zone');
  const pdfUpload = document.getElementById('pdf-upload');
  const uploadContent = document.getElementById('upload-content');
  const uploadProgress = document.getElementById('upload-progress');
  const uploadSuccess = document.getElementById('upload-success');
  const uploadBar = document.getElementById('upload-bar');
  const uploadPercent = document.getElementById('upload-percent');
  const uploadFilename = document.getElementById('upload-filename');
  const uploadStatus = document.getElementById('upload-status');
  const activeFilename = document.getElementById('active-filename');
  const btnRemovePdf = document.getElementById('btn-remove-pdf');

  const chatForm = document.getElementById('chat-form');
  const chatInput = document.getElementById('chat-input');
  const btnSend = document.getElementById('btn-send');
  const chatMessages = document.getElementById('chat-messages');

  const dashboardEmpty = document.getElementById('dashboard-empty');
  const dashboardContent = document.getElementById('dashboard-content');
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabPanes = document.querySelectorAll('.tab-pane');

  let isPdfUploaded = false;
  let isAwaitingPreferences = true;
  let userPreferences = "";

  /* --- Cleaning Helper --- */
  const cleanApiData = (obj) => {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj === 'string') {
      return obj
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
    }
    if (Array.isArray(obj)) {
      return obj.map(item => cleanApiData(item));
    }
    if (typeof obj === 'object') {
      const cleaned = {};
      for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          cleaned[key] = cleanApiData(obj[key]);
        }
      }
      return cleaned;
    }
    return obj;
  };

  /* --- Robust JSON Parser --- */
  const robustJsonParse = (str) => {
    try {
      return JSON.parse(str);
    } catch (e) {
      console.warn("Standard JSON.parse failed, attempting to sanitize control characters...", e);
      try {
        let sanitized = str;
        // Escape raw backslashes that are not part of a valid escape sequence
        sanitized = sanitized.replace(/\\(?!["\\/bfnrtu])/g, '\\\\');
        // Replace raw unescaped newlines/tabs inside double-quoted string values
        sanitized = sanitized.replace(/"([^"\\]*(?:\\.[^"\\]*)*)"/g, (match, p1) => {
          return '"' + p1.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t') + '"';
        });
        return JSON.parse(sanitized);
      } catch (err2) {
        console.error("Robust JSON parse failed:", err2);
        throw e; // Throw original error if sanitization fails
      }
    }
  };

  /* --- AI & PDF Logic --- */
  const callGeminiAPIWithRetry = async (url, options, retryCount = 3) => {
    let retries = retryCount;
    let delay = 2000;
    let response;
    let errorData;

    while (retries > 0) {
      response = await fetch(url, options);

      if (response.ok) {
        return response;
      }
      
      errorData = await response.json();
      const status = response.status;
      const errorMessage = errorData.error?.message || "";
      
      if (status === 429 || status === 503 || errorMessage.toLowerCase().includes("demand") || errorMessage.toLowerCase().includes("overload")) {
        retries--;
        if (retries === 0) break;
        console.warn(`API Error (${status}). Retrying in ${delay}ms...`, errorMessage);
        const uploadStatus = document.getElementById('upload-status');
        if(uploadStatus && !uploadStatus.closest('.hidden')) {
           uploadStatus.textContent = `API busy, retrying... (${retryCount - retries}/${retryCount})`;
        }
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2;
      } else {
        break;
      }
    }

    if (!response || !response.ok) {
      throw new Error(errorData?.error?.message || "API request failed.");
    }

    return response;
  };

  const extractTextFromPDF = async (file) => {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      let text = '';
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const pageText = content.items.map(item => item.str).join(' ');
        text += pageText + '\n';
      }
      return text;
    } catch (error) {
      console.error("PDF Extraction Error:", error);
      throw error;
    }
  };

  const analyzeDocumentWithGemini = async (text) => {
    const apiKeyInput = document.getElementById('gemini-api-key').value;
    if (!apiKeyInput) {
      throw new Error("Please enter a Gemini API Key to analyze the document.");
    }

    // We limit text length to avoid token limits for very large pdfs on the free tier, 
    // although 1.5-flash has a large context window, it's safe to limit for this demo.
    const truncatedText = text.substring(0, 40000);

    const prompt = `Analyze the following document text and provide a structured JSON response exactly matching the schema below. 
The user has provided the following preferences for customizing the notes: "${userPreferences}". 
Please heavily tailor the difficulty, tone, notesContent, notesTitle, notesStyle, summary, and overall content according to these preferences (e.g., adjust the language complexity for their age, and focus on the specific note types they requested).

Document Text:
"""
${truncatedText}
"""

Schema:
{
  "summary": "A clear, well-structured summary of the document using Markdown. Include a brief overview paragraph, followed by bullet points for key takeaways and short notes.",
  "difficulty": "Beginner, Intermediate, or Expert",
  "readTime": "Estimated read time in minutes (e.g. '15 min')",
  "conceptCount": "Number of key concepts (e.g. '8')",
  "studyPlan": [
    { "day": "Day 1: Topic", "time": "2 hours", "tasks": ["Task 1", "Task 2"] }
  ],
  "notesTitle": "A descriptive title for the notes based on user preferences (e.g. 'Short Notes', 'Expert Notes', 'Beginner Notes')",
  "notesStyle": "A short badge label for the notes style (e.g. 'Simplified', 'Bullet Points', 'Advanced')",
  "notesContent": "Markdown formatted notes tailoring the concepts to the user's preferences.",
  "quiz": [
    { "q": "Generate at least 10 questions derived STRICTLY from the document text.", "options": ["Option 1", "Option 2", "Option 3", "Option 4"], "a": "Index of correct option (0-3 as an integer)" }
  ],
  "recommendations": [
    { "title": "A search query for a YouTube video about the topic", "desc": "Why watch this?" }
  ]
}
Return ONLY valid JSON without markdown wrapping.`;

    const response = await callGeminiAPIWithRetry(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKeyInput}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              summary: { type: "STRING" },
              difficulty: { type: "STRING" },
              readTime: { type: "STRING" },
              conceptCount: { type: "STRING" },
              studyPlan: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  properties: {
                    day: { type: "STRING" },
                    time: { type: "STRING" },
                    tasks: {
                      type: "ARRAY",
                      items: { type: "STRING" }
                    }
                  },
                  required: ["day", "time", "tasks"]
                }
              },
              notesTitle: { type: "STRING" },
              notesStyle: { type: "STRING" },
              notesContent: { type: "STRING" },
              quiz: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  properties: {
                    q: { type: "STRING" },
                    options: {
                      type: "ARRAY",
                      items: { type: "STRING" }
                    },
                    a: { type: "INTEGER" }
                  },
                  required: ["q", "options", "a"]
                }
              },
              recommendations: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  properties: {
                    title: { type: "STRING" },
                    desc: { type: "STRING" }
                  },
                  required: ["title", "desc"]
                }
              }
            },
            required: [
              "summary",
              "difficulty",
              "readTime",
              "conceptCount",
              "studyPlan",
              "notesTitle",
              "notesStyle",
              "notesContent",
              "quiz",
              "recommendations"
            ]
          }
        }
      })
    });

    const data = await response.json();
    const candidateText = data.candidates[0].content.parts[0].text;
    const cleanText = candidateText.replace(/```json\n?|```\n?/g, '').trim();
    const parsedData = robustJsonParse(cleanText);
    return cleanApiData(parsedData);
  };

  const renderAnalysis = (data) => {
    // 1. Summary
    const contentSummary = document.getElementById('content-summary');
    if (data.summary) {
      if (window.marked) {
        contentSummary.innerHTML = marked.parse(data.summary);
      } else {
        contentSummary.innerHTML = `<pre class="whitespace-pre-wrap font-sans">${data.summary}</pre>`;
      }
    }

    document.getElementById('stat-concepts').textContent = data.conceptCount || "0";
    document.getElementById('stat-time').textContent = data.readTime || "10 min";
    document.getElementById('stat-diff').textContent = data.difficulty || "Beginner";

    // 2. Study Plan
    const contentPlan = document.getElementById('content-plan');
    if (data.studyPlan && Array.isArray(data.studyPlan)) {
      contentPlan.innerHTML = data.studyPlan.map((plan, i) => `
        <div class="relative ${i > 0 ? 'mt-8' : ''}">
          <div class="absolute w-3 h-3 ${i === 0 ? 'bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.8)] -left-[7px]' : 'bg-gray-300 dark:bg-gray-600 -left-[31px]'} rounded-full top-1"></div>
          <h4 class="font-bold text-gray-900 dark:text-white text-lg">${plan.day}</h4>
          <p class="text-sm text-gray-600 dark:text-gray-400 mt-1 font-medium bg-gray-100 dark:bg-gray-800 inline-block px-2 py-0.5 rounded text-xs mb-2">Estimated: ${plan.time}</p>
          <ul class="list-disc pl-5 text-sm text-gray-700 dark:text-gray-300 space-y-1 mt-1">
            ${(plan.tasks || []).map(t => `<li>${t}</li>`).join('')}
          </ul>
        </div>
      `).join('');
    }

    // 3. Notes
    const contentNotes = document.getElementById('content-notes');
    const tabNotesLabel = document.getElementById('tab-notes-label');
    const paneNotesTitle = document.getElementById('pane-notes-title');
    const paneNotesBadge = document.getElementById('pane-notes-badge');

    // Handle backward compatibility in case API still returns beginnerNotes
    const finalNotesContent = data.notesContent || data.beginnerNotes;

    if (finalNotesContent) {
      if (window.marked) {
        contentNotes.innerHTML = marked.parse(finalNotesContent);
      } else {
        contentNotes.innerHTML = `<pre class="whitespace-pre-wrap">${finalNotesContent}</pre>`;
      }
    }
    
    if (data.notesTitle) {
      if (tabNotesLabel) tabNotesLabel.textContent = data.notesTitle;
      if (paneNotesTitle) paneNotesTitle.textContent = data.notesTitle;
    }
    if (data.notesStyle && paneNotesBadge) {
      paneNotesBadge.textContent = data.notesStyle;
    }

    // 4. Quiz
    // 4. Quiz
    const contentQuiz = document.getElementById('content-quiz');
    const btnSubmitQuiz = document.getElementById('btn-submit-quiz');
    const quizScoreContainer = document.getElementById('quiz-score-container');
    const quizScoreText = document.getElementById('quiz-score-text');
    
    // Reset score UI
    if (quizScoreContainer) quizScoreContainer.classList.add('hidden');
    if (quizScoreText) quizScoreText.textContent = '0/0';

    if (data.quiz && Array.isArray(data.quiz)) {
      window.currentQuizData = data.quiz; // Store for evaluation
      contentQuiz.innerHTML = data.quiz.map((item, qIndex) => `
        <div class="quiz-item border border-gray-100 dark:border-dark-border p-4 rounded-xl" data-question-index="${qIndex}">
          <p class="font-semibold text-gray-900 dark:text-gray-100 mb-3"><span class="text-brand-500 mr-1">${qIndex + 1}.</span> ${item.q}</p>
          <div class="space-y-2">
            ${(item.options || []).map((opt, oIndex) => `
              <label class="quiz-option cursor-pointer flex items-center gap-2 p-2 rounded border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                <input type="radio" name="quiz-q${qIndex}" value="${oIndex}" class="w-4 h-4 text-brand-500 bg-gray-100 border-gray-300 focus:ring-brand-500 dark:focus:ring-brand-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600">
                <span class="text-sm text-gray-700 dark:text-gray-300">${opt}</span>
              </label>
            `).join('')}
          </div>
          <div class="answer-reveal hidden mt-3 p-3 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 text-sm rounded-lg border border-green-100 dark:border-green-900/30">
            <span class="font-bold">Correct Answer:</span> <span class="correct-text">${item.options && item.options[item.a] ? item.options[item.a] : 'Unknown'}</span>
          </div>
        </div>
      `).join('');
      
      if (btnSubmitQuiz) btnSubmitQuiz.classList.remove('hidden');
    } else {
      if (btnSubmitQuiz) btnSubmitQuiz.classList.add('hidden');
    }

    // 5. Recommendations
    const contentRecs = document.getElementById('content-recs');
    if (data.recommendations && Array.isArray(data.recommendations)) {
      contentRecs.innerHTML = data.recommendations.map(rec => `
        <div class="p-4 border border-gray-100 dark:border-dark-border rounded-xl hover:shadow-md transition-all cursor-pointer bg-white dark:bg-dark-surface group" onclick="window.open('https://www.youtube.com/results?search_query=${encodeURIComponent(rec.title)}', '_blank')">
          <div class="aspect-video bg-gray-200 dark:bg-gray-800 rounded-lg mb-3 relative overflow-hidden flex items-center justify-center">
            <div class="absolute inset-0 bg-black/40 flex items-center justify-center">
              <div class="w-10 h-10 bg-red-600 text-white rounded-full flex items-center justify-center text-sm shadow-lg group-hover:scale-110 transition-transform">
                <i class="fa-solid fa-play ml-1"></i>
              </div>
            </div>
          </div>
          <h4 class="font-bold text-gray-900 dark:text-white text-[15px] mb-1 line-clamp-2 leading-tight">${rec.title}</h4>
          <p class="text-[13px] text-gray-600 dark:text-gray-300 mb-2 line-clamp-2">${rec.desc}</p>
          <span class="text-xs text-brand-500 font-medium">Search on YouTube &rarr;</span>
        </div>
      `).join('');
    }
  };

  /* --- File Upload Logic --- */
  const handleFileUpload = async (file) => {
    if (!file) {
      alert("Please upload a valid file.");
      return;
    }
    
    if (isAwaitingPreferences) {
      alert("Please enter your preferences in the chat before uploading a document.");
      return;
    }

    const apiKeyInput = document.getElementById('gemini-api-key').value;
    if (!apiKeyInput) {
      alert("Please enter your Gemini API Key in the top right header to analyze documents.");
      return;
    }

    // Switch UI to Progress state
    uploadContent.classList.add('hidden');
    uploadProgress.classList.remove('hidden');
    uploadFilename.textContent = file.name;
    uploadBar.style.width = '0%';
    uploadPercent.textContent = '0%';

    // Create link to view PDF in case they want a new tab
    const objectUrl = URL.createObjectURL(file);
    activeFilename.innerHTML = `<a href="${objectUrl}" target="_blank" onclick="event.stopPropagation()" class="hover:underline text-brand-600 dark:text-brand-400" title="Click to open in new tab">${file.name}</a>`;

    // Embed the PDF in the newly created Document tab
    const pdfViewerFrame = document.getElementById('pdf-viewer-frame');
    if (pdfViewerFrame) {
      pdfViewerFrame.src = objectUrl;
    }

    try {
      uploadStatus.textContent = "Extracting text from PDF...";
      uploadBar.style.width = '30%';
      uploadPercent.textContent = '30%';

      const extractedText = await extractTextFromPDF(file);

      uploadStatus.textContent = "Generating study materials using AI...";
      uploadBar.style.width = '60%';
      uploadPercent.textContent = '60%';

      window.pdfTextContext = extractedText; // Store context for chat feature

      const aiData = await analyzeDocumentWithGemini(extractedText);

      uploadBar.style.width = '100%';
      uploadPercent.textContent = '100%';

      setTimeout(() => {
        // Finish Upload UI
        uploadProgress.classList.add('hidden');
        uploadSuccess.classList.remove('hidden');
        isPdfUploaded = true;

        // Enable Chat Input
        chatInput.disabled = false;
        btnSend.disabled = false;
        chatInput.focus();

        // Generate Dashboard
        dashboardEmpty.classList.add('hidden');
        dashboardContent.classList.remove('hidden');
        dashboardContent.classList.add('flex');

        renderAnalysis(aiData);

        // Add System Message to Chat with customized short notes
        const welcomeNotes = `### 🎉 File successfully analyzed!

I have populated your Analysis Dashboard and generated materials tailored to your preferences: **"${userPreferences}"**.

Here is a summary and **Short Notes** from your document:

${aiData.summary}

---
*You can view the full structured notes, study plan, and take a quiz in the dashboard tabs on the right. **Feel free to ask me for any specific explanations or detailed notes right here!***`;

        addMessage(welcomeNotes, false);

      }, 500);

    } catch (error) {
      console.error(error);
      alert("Error analyzing PDF: " + error.message);
      uploadProgress.classList.add('hidden');
      uploadContent.classList.remove('hidden');
      pdfUpload.value = '';
    }
  };

  // File input change
  pdfUpload.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleFileUpload(e.target.files[0]);
    }
  });

  // Ensure entire upload zone is clickable
  uploadZone.addEventListener('click', (e) => {
    if (!isPdfUploaded && !isAwaitingPreferences && e.target !== pdfUpload && !e.target.closest('label')) {
      pdfUpload.click();
    }
  });

  // Drag and drop events
  uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (!isPdfUploaded && !isAwaitingPreferences) uploadZone.classList.add('border-brand-500', 'bg-brand-50', 'dark:bg-brand-900/10');
  });

  uploadZone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('border-brand-500', 'bg-brand-50', 'dark:bg-brand-900/10');
  });

  uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('border-brand-500', 'bg-brand-50', 'dark:bg-brand-900/10');
    if (!isPdfUploaded && !isAwaitingPreferences && e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  });

  // Paste Support
  document.addEventListener('paste', (e) => {
    if (!isPdfUploaded && !isAwaitingPreferences && e.clipboardData && e.clipboardData.files.length > 0) {
      const file = e.clipboardData.files[0];
      if (file) {
        handleFileUpload(file);
      }
    }
  });

  // Remove PDF
  btnRemovePdf.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    isPdfUploaded = false;
    pdfUpload.value = '';

    uploadSuccess.classList.add('hidden');
    uploadContent.classList.remove('hidden');

    chatInput.disabled = true;
    btnSend.disabled = true;

    dashboardContent.classList.add('hidden');
    dashboardContent.classList.remove('flex');
    dashboardEmpty.classList.remove('hidden');

    // Clear chat (keep welcome message or reset to asking preferences)
    isAwaitingPreferences = true;
    userPreferences = "";
    pdfUpload.disabled = true;
    uploadContent.classList.add('opacity-50');
    document.getElementById('upload-icon-container').classList.remove('group-hover:scale-110');
    document.getElementById('upload-title-text').textContent = 'Awaiting Preferences...';
    document.getElementById('upload-subtitle-text').textContent = 'Please answer in the chat first';

    chatInput.disabled = false;
    btnSend.disabled = false;
    chatInput.placeholder = 'Type your preferences here...';

    const messages = chatMessages.querySelectorAll('.chat-bubble-container');
    messages.forEach(msg => {
      // We will replace innerHTML anyway
    });
    chatMessages.innerHTML = `
      <div class="flex gap-4">
        <div class="w-8 h-8 lg:w-10 lg:h-10 rounded-full bg-brand-100 dark:bg-brand-900/30 flex items-center justify-center flex-shrink-0 text-brand-600">
          <i class="fa-solid fa-robot"></i>
        </div>
        <div class="flex-1 space-y-2">
          <p class="font-medium text-sm text-gray-900 dark:text-gray-100">Study Assistant</p>
          <div class="text-[15px] leading-relaxed text-gray-700 dark:text-gray-300">
            Document removed. To start a new session, please tell me your age and what kind of notes you want to focus on.
          </div>
        </div>
      </div>
    `;
  });


  /* --- Helper to strip HTML tags --- */
  const stripHtml = (html) => {
    const tmp = document.createElement("div");
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || "";
  };

  /* --- Chat Logic --- */
  const addMessage = (text, isUser = false) => {
    // Clean any literal escape sequences in assistant responses
    let cleanedText = text;
    if (!isUser && typeof text === 'string') {
      cleanedText = text
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
    }

    const msgDiv = document.createElement('div');
    msgDiv.className = 'flex gap-4 chat-bubble-container ' + (isUser ? 'flex-row-reverse' : '');

    const iconHtml = isUser
      ? '<div class="w-8 h-8 lg:w-10 lg:h-10 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center flex-shrink-0 text-gray-600 dark:text-gray-300"><i class="fa-solid fa-user"></i></div>'
      : '<div class="w-8 h-8 lg:w-10 lg:h-10 rounded-full bg-brand-100 dark:bg-brand-900/30 flex items-center justify-center flex-shrink-0 text-brand-600"><i class="fa-solid fa-robot"></i></div>';

    const senderName = isUser ? 'You' : 'Study Assistant';
    const alignClass = isUser ? 'text-right' : 'text-left';
    
    const bubbleClass = isUser
      ? 'bg-brand-500 text-white rounded-2xl p-3 inline-block shadow-sm max-w-[85%]'
      : 'bg-white dark:bg-dark-surface border border-gray-150 dark:border-dark-border/60 rounded-2xl p-4 shadow-sm prose prose-sm dark:prose-invert max-w-[90%] text-gray-700 dark:text-gray-300 text-[15px] leading-relaxed relative group';

    let formattedText = cleanedText;
    if (!isUser && window.marked && !cleanedText.trim().startsWith('<')) {
      formattedText = marked.parse(cleanedText);
    }

    msgDiv.innerHTML = `
      ${iconHtml}
      <div class="flex-1 space-y-1 ${alignClass}">
        <p class="font-medium text-sm text-gray-900 dark:text-gray-100 ${isUser ? 'mr-1' : ''}">${senderName}</p>
        <div class="flex ${isUser ? 'justify-end' : 'justify-start'}">
          <div class="${bubbleClass}">
            <div class="chat-bubble-text">${formattedText}</div>
            ${!isUser ? `
              <div class="mt-2 pt-1.5 border-t border-gray-100 dark:border-gray-800/80 flex items-center">
                <button type="button" class="btn-speak text-xs text-gray-400 hover:text-brand-500 dark:hover:text-brand-400 flex items-center gap-1.5 transition-colors font-medium outline-none focus:outline-none" data-text="${stripHtml(formattedText).replace(/"/g, '&quot;').trim()}">
                  <i class="fa-solid fa-volume-high text-[10px]"></i><span>Listen</span>
                </button>
              </div>
            ` : ''}
          </div>
        </div>
      </div>
    `;

    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  };

  const showTypingIndicator = () => {
    const msgDiv = document.createElement('div');
    msgDiv.id = 'typing-indicator';
    msgDiv.className = 'flex gap-4 chat-bubble-container';
    msgDiv.innerHTML = `
      <div class="w-8 h-8 lg:w-10 lg:h-10 rounded-full bg-brand-100 dark:bg-brand-900/30 flex items-center justify-center flex-shrink-0 text-brand-600">
        <i class="fa-solid fa-robot"></i>
      </div>
      <div class="flex-1 space-y-2">
        <p class="font-medium text-sm text-gray-900 dark:text-gray-100">Study Assistant</p>
        <div class="flex gap-1 items-center pt-2 h-6">
          <div class="w-2 h-2 bg-brand-400 rounded-full typing-dot"></div>
          <div class="w-2 h-2 bg-brand-400 rounded-full typing-dot"></div>
          <div class="w-2 h-2 bg-brand-400 rounded-full typing-dot"></div>
        </div>
      </div>
    `;
    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  };

  const removeTypingIndicator = () => {
    const ind = document.getElementById('typing-indicator');
    if (ind) ind.remove();
  }

  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      chatForm.dispatchEvent(new Event('submit'));
    }
  });

  chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const val = chatInput.value.trim();
    if (!val) return;
    
    if (isAwaitingPreferences) {
      userPreferences = val;
      isAwaitingPreferences = false;
      addMessage(val, true);
      chatInput.value = '';
      chatInput.style.height = 'auto';
      chatInput.placeholder = 'Ask questions about your document...';
      
      // Enable Upload
      pdfUpload.disabled = false;
      uploadContent.classList.remove('opacity-50');
      document.getElementById('upload-icon-container').classList.add('group-hover:scale-110');
      document.getElementById('upload-title-text').textContent = 'Upload a file to begin';
      document.getElementById('upload-subtitle-text').innerHTML = 'Drag & drop or <span class="text-brand-500 hover:text-brand-600 font-semibold underline">browse file</span>';
      
      addMessage("Great! I've noted your preferences. Please upload a PDF document and I'll analyze it for you according to your needs.", false);
      return;
    }

    if (!isPdfUploaded) {
      addMessage("Please upload a PDF document first before asking questions.", false);
      chatInput.value = '';
      chatInput.style.height = 'auto';
      return;
    }

    const apiKeyInput = document.getElementById('gemini-api-key').value;
    if (!apiKeyInput) {
      alert("Please enter a Gemini API Key to use the chat feature.");
      return;
    }

    addMessage(val, true);
    chatInput.value = '';

    // Auto-resize reset
    chatInput.style.height = 'auto';

    // Call Gemini API for chat response
    showTypingIndicator();

    try {
      const prompt = `You are a highly skilled study assistant. The user has uploaded a study document and wants to ask questions, request detailed explanations, or view specific notes.
      
Current user preferences for study materials: "${userPreferences}"

User message: "${val}"

Analyze the user's message and the document context below. You MUST respond with a structured JSON object in the exact schema specified below:

Schema:
{
  "action": "update_preferences", "switch_tab", or null,
  "new_preferences": "a concise string summarizing their requested preferences (only if action is update_preferences)",
  "tab": "one of: tab-document, tab-summary, tab-plan, tab-notes, tab-quiz, tab-recs (only if action is switch_tab)",
  "explanation": "Detailed answer, notes, or explanations in markdown format addressing the user's query using the document context and tailored to the user's age and preferences."
}

Ensure the "explanation" field is rich, clear, uses markdown (bolding, lists, code blocks, etc.) to present notes and explanations, and is highly engaging. If they ask for notes, summarize or extract key notes from the document context.

Document Context:
${window.pdfTextContext ? window.pdfTextContext.substring(0, 30000) : "No document context available."}`;

      const response = await callGeminiAPIWithRetry(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKeyInput}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                action: { type: "STRING" },
                new_preferences: { type: "STRING" },
                tab: { type: "STRING" },
                explanation: { type: "STRING" }
              },
              required: ["action", "new_preferences", "tab", "explanation"]
            }
          }
        })
      });

      const data = await response.json();
      const answer = data.candidates[0].content.parts[0].text;

      removeTypingIndicator();

      let actionHandled = false;
      try {
        const cleanAnswer = answer.replace(/```json\n?|```\n?/g, '').trim();
        let parsed = robustJsonParse(cleanAnswer);
        parsed = cleanApiData(parsed);
        
        if (parsed.explanation) {
          addMessage(parsed.explanation, false);
        } else {
          addMessage(answer, false);
        }

        if (parsed.action === 'update_preferences' && parsed.new_preferences) {
          actionHandled = true;
          userPreferences = parsed.new_preferences;
          addMessage("Updating your preferences to: " + userPreferences + ". Please wait while I regenerate the study materials...", false);
          
          showTypingIndicator();
          try {
            const aiData = await analyzeDocumentWithGemini(window.pdfTextContext);
            renderAnalysis(aiData);
            removeTypingIndicator();
            addMessage("I have updated the dashboard with your new preferences!", false);
            
            // Switch to the notes tab automatically
            const notesBtn = Array.from(tabBtns).find(b => b.getAttribute('data-target') === 'tab-notes');
            if (notesBtn) notesBtn.click();
          } catch (regenErr) {
            removeTypingIndicator();
            console.error(regenErr);
            addMessage("Failed to update dashboard: " + regenErr.message, false);
          }
        } else if (parsed.action === 'switch_tab' && parsed.tab) {
          actionHandled = true;
          const targetBtn = Array.from(tabBtns).find(b => b.getAttribute('data-target') === parsed.tab);
          if (targetBtn) {
            targetBtn.click();
          }
        }
      } catch (parseErr) {
        console.error("JSON parse error:", parseErr);
        // Fallback: Try to extract the explanation field using regex or show cleaned raw text
        let fallbackText = answer;
        const explanationMatch = answer.match(/"explanation"\s*:\s*"((?:[^"\\]|\\.)*)"/);
        if (explanationMatch && explanationMatch[1]) {
          try {
            fallbackText = JSON.parse(`"${explanationMatch[1]}"`);
          } catch (e) {
            fallbackText = explanationMatch[1];
          }
        } else {
          fallbackText = answer.replace(/```json\n?|```\n?/g, '').trim();
        }
        addMessage(cleanApiData(fallbackText), false);
      }

    } catch (err) {
      console.error(err);
      removeTypingIndicator();
      addMessage("Sorry, I encountered an error while trying to answer that. Please check your API key and connection.", false);
    }
  });

  // Auto-resize textarea
  chatInput.addEventListener('input', function () {
    this.style.height = 'auto';
    this.style.height = (this.scrollHeight) + 'px';
  });

  /* --- Tabs Logic --- */
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      // Deactivate all
      tabBtns.forEach(b => {
        b.classList.remove('active', 'border-b-2', 'border-brand-500', 'text-brand-600', 'dark:text-brand-400');
        b.classList.add('text-gray-500');
      });
      tabPanes.forEach(p => p.classList.add('hidden'));

      // Activate clicked
      btn.classList.remove('text-gray-500');
      btn.classList.add('active', 'border-b-2', 'border-brand-500', 'text-brand-600', 'dark:text-brand-400');

      const targetId = btn.getAttribute('data-target');
      document.getElementById(targetId).classList.remove('hidden');
    });
  });

  /* --- Quiz Submission Logic --- */
  const btnSubmitQuiz = document.getElementById('btn-submit-quiz');
  if (btnSubmitQuiz) {
    btnSubmitQuiz.addEventListener('click', () => {
      if (!window.currentQuizData) return;
      
      const scoreContainer = document.getElementById('quiz-score-container');
      const scoreText = document.getElementById('quiz-score-text');
      
      let score = 0;
      const total = window.currentQuizData.length;
      
      window.currentQuizData.forEach((item, qIndex) => {
        const selected = document.querySelector(`input[name="quiz-q${qIndex}"]:checked`);
        const itemEl = document.querySelector(`.quiz-item[data-question-index="${qIndex}"]`);
        if (!itemEl) return;
        
        // Show correct answer text
        const revealEl = itemEl.querySelector('.answer-reveal');
        if (revealEl) revealEl.classList.remove('hidden');
        
        const correctIndex = parseInt(item.a);
        
        // Disable all inputs in this question
        itemEl.querySelectorAll('input[type="radio"]').forEach(radio => {
          radio.disabled = true;
          // Highlight correct option
          if (parseInt(radio.value) === correctIndex) {
            radio.closest('.quiz-option').classList.add('bg-green-100', 'dark:bg-green-900/40', 'border-green-300', 'dark:border-green-700');
          }
        });
        
        if (selected && parseInt(selected.value) === correctIndex) {
          score++;
        } else if (selected) {
          // Highlight incorrect selection
          selected.closest('.quiz-option').classList.add('bg-red-100', 'dark:bg-red-900/40', 'border-red-300', 'dark:border-red-700');
        }
      });
      
      if (scoreText) scoreText.textContent = `${score}/${total}`;
      if (scoreContainer) scoreContainer.classList.remove('hidden');
      btnSubmitQuiz.classList.add('hidden');
      
      // Auto scroll to score
      if (scoreContainer) {
         scoreContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  }

  /* --- Audio & Speech Features (STT & TTS) --- */
  const btnMic = document.getElementById('btn-mic');
  let isListening = false;

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SpeechRecognition && btnMic) {
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    btnMic.addEventListener('click', () => {
      if (isListening) {
        recognition.stop();
      } else {
        recognition.start();
      }
    });

    recognition.onstart = () => {
      isListening = true;
      btnMic.classList.remove('bg-gray-100', 'text-gray-500', 'dark:bg-gray-800', 'dark:text-gray-400');
      btnMic.classList.add('bg-red-500', 'text-white', 'animate-pulse');
      chatInput.placeholder = 'Listening... Speak now...';
    };

    recognition.onspeechend = () => {
      recognition.stop();
    };

    recognition.onend = () => {
      isListening = false;
      btnMic.classList.add('bg-gray-100', 'text-gray-500', 'dark:bg-gray-800', 'dark:text-gray-400');
      btnMic.classList.remove('bg-red-500', 'text-white', 'animate-pulse');
      chatInput.placeholder = isAwaitingPreferences ? 'Type your preferences here...' : 'Ask questions about your document...';
    };

    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      chatInput.value = (chatInput.value + ' ' + transcript).trim();
      // Auto-resize input height
      chatInput.style.height = 'auto';
      chatInput.style.height = chatInput.scrollHeight + 'px';
      chatInput.focus();
    };

    recognition.onerror = (event) => {
      console.error('Speech recognition error:', event.error);
      if (event.error === 'no-speech') {
        return;
      }

      let friendlyMessage = '';
      if (event.error === 'not-allowed') {
        friendlyMessage = "🎙️ Microphone Access Blocked:\n\nPlease click the microphone permission icon in your browser's address bar and set it to 'Allow'.\n\nNote: Browsers require pages to be served securely (either via http://localhost or HTTPS) to allow microphone recording.";
      } else if (event.error === 'audio-capture') {
        friendlyMessage = "🎙️ Microphone Capture Failed:\n\n1. Please ensure your microphone is plugged in, configured as your default system input device, and not muted.\n2. Make sure no other application (like Zoom, Teams, or Discord) is currently using your microphone.\n3. Verify that your Operating System allows browser microphone access (check your OS Privacy Settings).";
      } else if (event.error === 'network') {
        friendlyMessage = "🌐 Network Error:\n\nSpeech recognition requires an internet connection. Please verify your connection and try again.";
      } else {
        friendlyMessage = `Voice Input Issue (${event.error}):\n\nPlease check your microphone settings and try again.`;
      }

      alert(friendlyMessage);
    };
  } else if (btnMic) {
    // If browser doesn't support SpeechRecognition, we hide it or show an informative tooltip
    btnMic.title = "Speech input is not supported in this browser.";
    btnMic.classList.add('opacity-40', 'cursor-not-allowed');
    btnMic.addEventListener('click', () => {
      alert("Voice input (Speech to Text) is not supported in your current browser. Please try Google Chrome or MS Edge.");
    });
  }

  // Event Delegation for TTS (Listen to chatbot response)
  chatMessages.addEventListener('click', (e) => {
    const btnSpeak = e.target.closest('.btn-speak');
    if (btnSpeak) {
      const textToSpeak = btnSpeak.getAttribute('data-text');
      const icon = btnSpeak.querySelector('i');
      const span = btnSpeak.querySelector('span');
      
      if (window.speechSynthesis.speaking) {
        window.speechSynthesis.cancel();
        // Reset all speak buttons to initial state
        document.querySelectorAll('.btn-speak i').forEach(item => {
          item.className = 'fa-solid fa-volume-high text-[10px]';
        });
        document.querySelectorAll('.btn-speak span').forEach(item => {
          item.textContent = 'Listen';
        });
      } else {
        // Stop any ongoing speech first
        window.speechSynthesis.cancel();

        // Change icon to stop/square
        if (icon) icon.className = 'fa-solid fa-stop text-[10px] text-red-500';
        if (span) span.textContent = 'Stop';
        
        const utterance = new SpeechSynthesisUtterance(textToSpeak);
        utterance.rate = 0.95; // Slightly slower than 1.0 for improved clarity and pleasant pacing
        utterance.pitch = 1.02; // A tiny bit higher pitch for a bright, warm, and friendly assistant tone
        
        // Find a nice, natural, and pleasant English voice
        const voices = window.speechSynthesis.getVoices();
        if (voices && voices.length > 0) {
          // Curated list of high-quality/natural voice patterns in order of preference
          const preferredVoicePatterns = [
            /google\s+us\s+english/i,
            /google\s+uk\s+english\s+female/i,
            /samantha/i,
            /microsoft\s+aria/i, // Premium Microsoft online assistant voice
            /microsoft\s+zira/i, // Pleasant Windows standard female voice
            /natural/i,
            /google/i,
            /english/i,
            /^en/i
          ];
          
          let selectedVoice = null;
          
          // Try to match preferred voice patterns
          for (const pattern of preferredVoicePatterns) {
            selectedVoice = voices.find(v => 
              (v.lang.startsWith('en') || v.lang.startsWith('EN')) && 
              pattern.test(v.name)
            );
            if (selectedVoice) break;
          }
          
          // Fallback to any English voice
          if (!selectedVoice) {
            selectedVoice = voices.find(v => v.lang.startsWith('en') || v.lang.startsWith('EN'));
          }
          
          if (selectedVoice) {
            utterance.voice = selectedVoice;
            console.log("Selected pleasant voice:", selectedVoice.name, selectedVoice.lang);
          }
        }
        
        utterance.onend = () => {
          if (icon) icon.className = 'fa-solid fa-volume-high text-[10px]';
          if (span) span.textContent = 'Listen';
        };
        utterance.onerror = () => {
          if (icon) icon.className = 'fa-solid fa-volume-high text-[10px]';
          if (span) span.textContent = 'Listen';
        };
        
        window.speechSynthesis.speak(utterance);
      }
    }
  });

});
