require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const pdfParse = require("pdf-parse");
const { Ollama } = require("ollama");
const admin = require("firebase-admin");
const { getFirestore } = require("firebase-admin/firestore");

// Initialize Firebase with service account
const serviceAccount = require("./firebase-service-account.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = getFirestore();

// Set Ollama model name and host via environment so you can point to a GPU-enabled server
const MODEL_NAME = process.env.MODEL_NAME || "phi3:mini"; // default Phi-3:mini model
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';

// Create Ollama client (host configurable)
const ollama = new Ollama({ host: OLLAMA_HOST });
// Hosted fallback config (set these in .env if you want a hosted model fallback)
const HOSTED_AI_ENDPOINT = process.env.HOSTED_AI_ENDPOINT || '';
const HOSTED_API_KEY = process.env.HOSTED_API_KEY || '';
let useHostedFallback = false; // switched to true at startup if local Ollama is not GPU-capable

const app = express();

app.use(cors());
// Limit JSON body size to avoid memory spikes on low-RAM machines
app.use(express.json({ limit: '200kb' }));

// GPU detection (basic): macOS: use system_profiler to look for GPU; Linux: check for /proc/driver/nvidia
const os = require('os');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
function hasGpuAvailable() {
  try {
    const platform = os.platform();
    if (platform === 'darwin') {
      const out = execSync('system_profiler SPDisplaysDataType -detailLevel mini').toString();
      return /AMD|Radeon|NVIDIA|Intel/i.test(out);
    } else if (platform === 'linux') {
      // Check for nvidia driver or radeontop availability
      if (require('fs').existsSync('/proc/driver/nvidia')) return true;
      const lspci = execSync('lspci -nnk | grep -i vga || true').toString();
      return /AMD|Radeon|NVIDIA|NVIDIA/i.test(lspci);
    } else if (platform === 'win32') {
      const out = execSync('wmic path win32_VideoController get name').toString();
      return /AMD|Radeon|NVIDIA|Intel/i.test(out);
    }
  } catch (e) {
    // If detection fails, assume no GPU
    return false;
  }
  return false;
}

// Startup check: if OLLAMA_HOST is local and no GPU present, warn and enable hosted fallback if configured
const localHosts = ['http://127.0.0.1:11434', 'http://localhost:11434', '127.0.0.1:11434', 'localhost:11434'];
const runningOnLocalOllama = localHosts.includes(OLLAMA_HOST);
const gpuAvailable = hasGpuAvailable();
if (runningOnLocalOllama && !gpuAvailable) {
  console.warn(`Warning: OLLAMA_HOST is local (${OLLAMA_HOST}) but no GPU was detected on this machine.`);
  if (HOSTED_AI_ENDPOINT && HOSTED_API_KEY) {
    console.warn('A hosted AI fallback is configured and will be used for heavy model calls.');
    useHostedFallback = true;
  } else {
    console.warn('No hosted fallback configured. Model calls will run on CPU locally which may be slow.');
  }
}

// Accept only PDF uploads and limit file size to 2MB to reduce processing time
const upload = multer({ 
  dest: "uploads/",
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Only PDF files are allowed'));
  }
});

// Simple concurrency limiter for Ollama calls to avoid CPU spikes
let ollamaBusy = false;
const withOllama = async (fn) => {
  while (ollamaBusy) {
    await new Promise(r => setTimeout(r, 200));
  }
  try {
    ollamaBusy = true;
    return await fn();
  } finally {
    ollamaBusy = false;
  }
};

// Hosted fallback caller (expects HOSTED_AI_ENDPOINT to accept {model, messages} and return {message: {content}} )
const fetch = require('node-fetch');
async function callHostedModel({ model, messages }) {
  if (!HOSTED_AI_ENDPOINT || !HOSTED_API_KEY) throw new Error('Hosted model not configured');
  const resp = await fetch(HOSTED_AI_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${HOSTED_API_KEY}`
    },
    body: JSON.stringify({ model, messages })
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Hosted model error: ${resp.status} ${txt}`);
  }
  const data = await resp.json();
  // Normalize to ollama.chat-like response
  return { message: { content: data.output || data.message?.content || data.content || '' } };
}

// Wrapper to use hosted fallback when flagged
async function runModelCall({ model, messages }) {
  // Prefer hosted fallback if explicitly enabled
  if (useHostedFallback) {
    return await callHostedModel({ model, messages });
  }
  // Try local Ollama first; if it fails and hosted fallback is configured, use it
  try {
    return await ollama.chat({ model, messages });
  } catch (localErr) {
    console.error('Local Ollama call failed:', localErr.message || localErr);
    if (HOSTED_AI_ENDPOINT && HOSTED_API_KEY) {
      console.warn('Falling back to hosted model due to local Ollama error');
      return await callHostedModel({ model, messages });
    }
    throw localErr;
  }
}

app.post("/api/uploadResume", upload.single("resume"), async (req, res) => {
  try {
    const filePath = req.file.path;
    const fileBuffer = require("fs").readFileSync(filePath);
    const pdfData = await pdfParse(fileBuffer);
    // Truncate resume text to reduce model input size on low-resource machines
    let resumeText = pdfData.text || '';
    const MAX_RESUME_CHARS = parseInt(process.env.MAX_RESUME_CHARS || '3000', 10);
    if (resumeText.length > MAX_RESUME_CHARS) {
      resumeText = resumeText.slice(0, MAX_RESUME_CHARS) + '\n\n[TRUNCATED]';
    }
    
    // Use Ollama Phi-3 to analyze and summarize the resume
    const prompt = `
    You are a professional resume analyzer. Please analyze the following resume and provide a concise summary 
    highlighting key skills, experience, and qualifications. Focus on the most relevant information.
    
    RESUME:
    ${resumeText}
    
    Provide a summary in 3-4 paragraphs.
    `;
    
    const ollamaResponse = await withOllama(() => runModelCall({
       model: MODEL_NAME,
       messages: [{ role: 'user', content: prompt }]
     }));
     
     const summary = ollamaResponse.message.content;

    // Save summary to Firestore (optional: associate with user)
    // await db.collection("resumes").add({ summary, uploadedAt: new Date() });

  // Clean up uploaded file to save disk
  try { require('fs').unlinkSync(filePath); } catch(e){}
    res.json({ summary });
  } catch (err) {
    console.error("Resume parsing error:", err);
    res.status(500).json({ error: "Resume parsing failed" });
  }
});

app.post("/api/generateQuestions", async (req, res) => {
  try {
    let { resumeSummary, role, interviewType, duration } = req.body;
    // Truncate resumeSummary to limit tokens sent to model
    const MAX_SUMMARY_CHARS = parseInt(process.env.MAX_SUMMARY_CHARS || '2000', 10);
    if (resumeSummary && resumeSummary.length > MAX_SUMMARY_CHARS) {
      resumeSummary = resumeSummary.slice(0, MAX_SUMMARY_CHARS) + '\n\n[TRUNCATED]';
    }

  // Always generate 8 questions for a 10-minute interview: 4 resume-based, 4 role-based
  const numQuestions = 8;
  // Create a prompt for Ollama to generate interview questions
  const prompt = `
  You are an expert interviewer for ${role} positions. Based on the following resume summary, generate 8 interview questions for a 10-minute interview:
  - The first 4 questions should be based on the candidate's resume and experience.
  - The next 4 questions should be based on the job role (${role}) and general expectations for this position.
    
  RESUME SUMMARY:
  ${resumeSummary}
    
  JOB ROLE: ${role}
  INTERVIEW TYPE: ${interviewType}
  DURATION: ${duration} minutes
    
  Format your response as a JSON array of strings, with each string being a question. Example format: ["Resume Q1?", "Resume Q2?", "Resume Q3?", "Resume Q4?", "Role Q1?", "Role Q2?", "Role Q3?", "Role Q4?"]
  `;
    
    const ollamaResponse = await withOllama(() => runModelCall({
      model: MODEL_NAME,
      messages: [{ role: 'user', content: prompt }]
    }));
    
    // Parse the response to extract questions
  let questions = [];
    try {
      // Try to parse as JSON
      const responseText = ollamaResponse.message.content.trim();
      // Find JSON array in the response (it might be embedded in other text)
      const jsonMatch = responseText.match(/\[.*\]/s);
      
        if (jsonMatch) {
          // Remove unwanted leading/trailing backticks, quotes, or spaces
          let cleanJson = jsonMatch[0].replace(/^[`"' ]+|[`"' ]+$/g, "");
          try {
            questions = JSON.parse(cleanJson);
          } catch (jsonErr) {
            // Fallback: extract lines ending with '?'
            questions = cleanJson
              .split('\n')
              .map(line => line.trim())
              .filter(line => line.endsWith('?'));
          }
        } else {
          // Fallback: Split by newlines and clean up
          questions = responseText
            .split('\n')
            .filter(line => line.trim().endsWith('?'))
            .map(line => line.trim());
        }
    } catch (parseError) {
      console.error("Error parsing questions:", parseError);
      // Fallback questions if parsing fails
  if (interviewType === "Technical") {
    questions = [
      `Explain your experience with ${role}.`,
      `Describe a technical challenge you faced and how you solved it.`,
      `What are the key technologies mentioned in your resume?`,
      `How would you approach a new project as a ${role}?`,
    ];
  } else if (interviewType === "HR") {
    questions = [
      "Tell me about yourself.",
      "Where do you see yourself in five years?",
      "Why do you want to join this company?",
      "How do you handle stress and pressure?",
    ];
  }
    }
    
    // Ensure we have exactly 8 questions
    if (questions.length < numQuestions) {
      // Add generic resume-based and role-based questions if needed
      const resumeGeneric = [
        `Can you elaborate on a key achievement from your resume?`,
        `Describe a challenge you overcame in your previous experience.`,
        `What skills from your resume do you consider most relevant?`,
        `How has your experience prepared you for this role?`
      ];
      const roleGeneric = [
        `What do you think are the most important skills for a ${role}?`,
        `How would you approach a new project as a ${role}?`,
        `Describe your understanding of the responsibilities of a ${role}.`,
        `What makes you a good fit for the ${role} position?`
      ];
      // Fill missing resume-based questions (first 4)
      while (questions.length < 4 && resumeGeneric.length > 0) {
        questions.push(resumeGeneric.shift());
      }
      // Fill missing role-based questions (next 4)
      while (questions.length < numQuestions && roleGeneric.length > 0) {
        questions.push(roleGeneric.shift());
      }
    }
    // Limit to 8 questions
    questions = questions.slice(0, numQuestions);

  res.json({ questions });
  } catch (err) {
    console.error("Question generation error:", err);
    res.status(500).json({ error: "Failed to generate questions" });
  }
});

app.get("/api/userAnalytics", async (req, res) => {
  const { uid } = req.query;
  
  if (!uid) {
    return res.status(400).json({ error: "User ID is required" });
  }
  
  try {
    // Fetch user's interview history from Firestore
    const interviewsSnapshot = await db.collection("interviews")
      .where("userId", "==", uid)
      .orderBy("timestamp", "desc")
      .get();
    
    if (interviewsSnapshot.empty) {
      return res.json({
        resumeHighlights: "",
        performanceSummary: "No interview data available yet.",
        suggestions: ["Complete your first interview to get feedback"],
        pastInterviews: []
      });
    }
    
    // Process interview data
    const pastInterviews = [];
    let totalTechnicalScore = 0;
    let totalCommunicationScore = 0;
    let totalOverallScore = 0;
    let interviewCount = 0;
    
    interviewsSnapshot.forEach(doc => {
      const data = doc.data();
      const scores = data.scores || {};
      
      // Calculate average scores
      if (scores.technicalKnowledge) totalTechnicalScore += scores.technicalKnowledge;
      if (scores.communication) totalCommunicationScore += scores.communication;
      if (scores.overallImpression) totalOverallScore += scores.overallImpression;
      interviewCount++;
      
      // Format interview data for frontend
      pastInterviews.push({
        id: doc.id,
        date: data.timestamp.toDate().toISOString().split('T')[0],
        role: data.role || "",
        interviewType: data.interviewType || "",
        duration: data.duration || 0,
        totalScore: (data.totalScore !== undefined && data.totalScore !== null) ? data.totalScore : (data.feedback?.totalScore || 0),
        feedback: data.feedback?.feedback || "",
        strengths: data.feedback?.strengths || [],
        improvements: data.feedback?.improvements || [],
        recommendations: data.feedback?.recommendations || [],
        scores: scores,
        questions: data.questions || [],
        answers: data.userAnswers || []
      });
    });
    
    // Generate performance summary based on scores
    const avgTechnical = interviewCount > 0 ? (totalTechnicalScore / interviewCount).toFixed(1) : "N/A";
    const avgCommunication = interviewCount > 0 ? (totalCommunicationScore / interviewCount).toFixed(1) : "N/A";
    const avgOverall = interviewCount > 0 ? (totalOverallScore / interviewCount).toFixed(1) : "N/A";
    
    const performanceSummary = `Based on ${interviewCount} interview(s): Technical: ${avgTechnical}/10, Communication: ${avgCommunication}/10, Overall: ${avgOverall}/10`;
    
    // Get the most recent resume summary
    const resumeHighlights = pastInterviews.length > 0 ? 
      pastInterviews[0].resumeSummary || "No resume data available" : 
      "No resume data available";
    
    // Collect all improvement suggestions
    const allSuggestions = new Set();
    pastInterviews.forEach(interview => {
      (interview.improvements || []).forEach(improvement => {
        allSuggestions.add(improvement);
      });
    });
    
    res.json({
      resumeHighlights,
      performanceSummary,
      suggestions: Array.from(allSuggestions).slice(0, 5), // Top 5 suggestions
      pastInterviews
    });
  } catch (error) {
    console.error("Error fetching user analytics:", error);
    res.status(500).json({ 
      error: "Failed to fetch user analytics",
      message: "An error occurred while retrieving your interview history."
    });
  }
});

app.post("/api/feedback", async (req, res) => {
  try {
    const { resumeSummary, interviewForm, questions, userAnswers, feedback, userId, uid } = req.body;
    const effectiveUserId = userId || uid;

  // Create a prompt for Ollama to generate interview feedback with scoring.
  // IMPORTANT: Instruct the model to base feedback ONLY on the QUESTIONS AND ANSWERS
  // provided (ignore the resume). Return a single JSON object with these keys:
  // {
  //   "strengths": [string],
  //   "improvements": [string],
  //   "recommendations": [string],
  //   "technicalKnowledge": number (0-10),
  //   "problemSolving": number (0-10),
  //   "communication": number (0-10),
  //   "totalScore": number (0-30),
  //   "detailedAnalysis": string
  // }
  // Do not repeat sections; keep arrays concise (3-6 items). Base all scoring
  // and recommendations only on the candidate's answers to the interview questions.
  const prompt = `
  You are an expert interview coach. Analyze the following QUESTIONS AND ANSWERS and provide constructive feedback.

  NOTE: Ignore the resume and base all feedback and scoring ONLY on the candidate's answers below.

  JOB ROLE: ${interviewForm.role}
  INTERVIEW TYPE: ${interviewForm.interviewType}

  QUESTIONS AND ANSWERS:
  ${questions.map((q, i) => `Q: ${q}\nA: ${userAnswers[i] || "No answer provided"}`).join('\n\n')}

  Return a single JSON object only, exactly with these keys: strengths (array of strings), improvements (array of strings), recommendations (array of strings), technicalKnowledge (integer 0-10), problemSolving (integer 0-10), communication (integer 0-10), totalScore (integer 0-30), detailedAnalysis (string).

  Keep arrays short (3-6 concise bullets). Do not include any duplicate sections or repeat the same content twice. If the candidate skipped questions or provided very short answers, reflect that in the scores.
  `;

    const ollamaResponse = await withOllama(() => runModelCall({
      model: MODEL_NAME,
      messages: [{ role: 'user', content: prompt }]
    }));

    let feedbackData = {};
    const responseText = (ollamaResponse.message.content || '').trim();

    // JSON repair helper: attempt to clean common formatting mistakes
    const tryRepairAndParse = (text) => {
      if (!text || !text.trim()) return null;
      // Strip markdown fences/backticks
      let s = text.replace(/```[\s\S]*?```/g, match => match.replace(/```/g, ''));
      s = s.replace(/`/g, '');
      // Extract the first object-like substring
      const objMatch = s.match(/\{[\s\S]*\}/);
      const candidate = objMatch ? objMatch[0] : s;
      // Clean common issues
      let cleaned = candidate
        .replace(/(\w+)\s*:/g, '"$1":') // Quote property names
        .replace(/([\{,\s])'([^']*)'/g, '$1"$2"') // single quotes to double when safe
        .replace(/\,\s*([}\]])/g, '$1') // remove trailing commas
        .replace(/\r?\n/g, ' ') // remove newlines
        .replace(/\s+/g, ' ')
        .trim();
      try {
        return JSON.parse(cleaned);
      } catch (e) {
        return null;
      }
    };

    // Try parsing original response, then repaired, then retry the model a couple times asking for strict JSON
    const maxRetries = 2;
    let parsed = null;
    try {
      try {
        parsed = JSON.parse(responseText);
      } catch (e) {
        // try repair-and-parse
        parsed = tryRepairAndParse(responseText);
      }

      let attempts = 0;
      while ((!parsed || typeof parsed !== 'object') && attempts < maxRetries) {
        attempts++;
        // Ask the model to convert its previous output into strict JSON following the required schema
        const repairPrompt = `You previously generated this output: '''\n${responseText}\n'''\n\nPlease convert that output into a single VALID JSON object with these keys exactly: strengths (array of short strings), improvements (array of short strings), recommendations (array of short strings), technicalKnowledge (integer 0-10), problemSolving (integer 0-10), communication (integer 0-10), totalScore (integer 0-30), detailedAnalysis (string). Return only the JSON object and nothing else.`;
        const repairResp = await withOllama(() => runModelCall({ model: MODEL_NAME, messages: [{ role: 'user', content: repairPrompt }] }));
        const repairText = (repairResp.message.content || '').trim();
        parsed = tryRepairAndParse(repairText) || parsed;
        // if still not parsed, set responseText to repairText for next attempt
        if (!parsed) {
          // update for next loop
          // eslint-disable-next-line no-unused-vars
          responseText = repairText;
        }
      }
    } catch (parseError) {
      console.error('Error parsing/repairing feedback JSON:', parseError);
    }

    if (parsed && typeof parsed === 'object') {
      feedbackData = parsed;
    } else {
      // fallback to raw text
      feedbackData = {
        feedback: responseText || ollamaResponse.message.content || '',
        strengths: [],
        improvements: [],
        recommendations: []
      };
    }

  // Heuristic scoring if missing or incomplete (based on answers length, diversity, and presence of keywords)
    const defaultScores = {
      technicalKnowledge: 0,
      problemSolving: 0,
      communication: 0,
      experienceRelevance: 0,
      industryKnowledge: 0,
      culturalFit: 0,
      confidence: 0,
      presentation: 0,
      behavior: 0,
      overallImpression: 0
    };
    const scores = { ...(feedbackData.scores || {}), ...defaultScores };

    // Compute heuristics only if categories are missing or zero
    function clamp01(x){ return Math.max(0, Math.min(1, x)); }
    const answersText = (userAnswers || []).join(' ').toLowerCase();
    const numAnswers = (userAnswers || []).filter(a => (a||'').trim().length > 0).length;
    const avgLen = numAnswers ? (userAnswers.reduce((s,a)=>s+((a||'').length),0)/numAnswers) : 0;
    const hasTechWords = /(react|node|java|spring|python|sql|api|system|architecture|algorithm|data|docker|kubernetes)/i.test(answersText);
    const hasBehaviorWords = /(team|collaborat|lead|communicat|resolve|conflict|adapt|learn|improv|feedback)/i.test(answersText);

    const lenScore = clamp01(avgLen / 180) * 10; // ~180 chars avg ≈ 10
    const diversityScore = clamp01(numAnswers / Math.max(questions.length || 1,1)) * 10;
    const techScore = (hasTechWords ? 8 : 4) + clamp01(avgLen/300)*2;
    const commScore = clamp01(avgLen / 160) * 8 + 2; // longer, clearer answers => higher
    const behaviorScore = (hasBehaviorWords ? 7 : 4) + clamp01(numAnswers/ (questions.length||1))*3;

    // Question/Answer relevance-based scoring (0 if skipped or irrelevant)
    const STOP = new Set(['the','a','an','and','or','if','in','on','at','for','of','to','with','by','is','are','was','were','be','as','that','this','it','from']);
    function tokens(str){ return (str||'').toLowerCase().split(/[^a-z0-9]+/).filter(w=>w && !STOP.has(w)); }
    function relevance(question, answer){
      const qTok = tokens(question);
      const aTok = tokens(answer);
      if (!answer || /^(skipped|no answer)/i.test(answer.trim())) return 0;
      if (aTok.length === 0 || qTok.length === 0) return 0;
      const qSet = new Set(qTok);
      let overlap = 0;
      for (const w of aTok){ if (qSet.has(w)) overlap++; }
      const rel = overlap / Math.max(3, qSet.size); // normalize
      return clamp01(rel * 2); // scale a bit up
    }
    const perItem = (questions||[]).map((q,i)=>({
      rel: relevance(q, (userAnswers||[])[i]||''),
      len: ((userAnswers||[])[i]||'').length
    }));
    const relAvg = perItem.length ? perItem.reduce((s,x)=>s+x.rel,0)/perItem.length : 0;
    const answeredRatio = perItem.length ? perItem.filter(x=>x.len>0).length / perItem.length : 0;

    const computed = {
      technicalKnowledge: Math.round(clamp01((techScore/10*0.5) + relAvg*0.5) * 10),
      problemSolving: Math.round(clamp01((lenScore/10*0.4) + relAvg*0.6) * 10),
      communication: Math.round(clamp01((commScore/10*0.6) + answeredRatio*0.4) * 10)
    };

    // Use computed three-category scores unless model provided explicit values
    const normalizedScores = {
      technicalKnowledge: (feedbackData.technicalKnowledge && Number(feedbackData.technicalKnowledge) >= 0) ? Number(feedbackData.technicalKnowledge) : computed.technicalKnowledge,
      problemSolving: (feedbackData.problemSolving && Number(feedbackData.problemSolving) >= 0) ? Number(feedbackData.problemSolving) : computed.problemSolving,
      communication: (feedbackData.communication && Number(feedbackData.communication) >= 0) ? Number(feedbackData.communication) : computed.communication
    };

    // Clamp 0-10
    Object.keys(normalizedScores).forEach(k => {
      normalizedScores[k] = Math.max(0, Math.min(10, Math.round(normalizedScores[k])));
    });

    const total30 = normalizedScores.technicalKnowledge + normalizedScores.problemSolving + normalizedScores.communication;

    // Deduplicate arrays if model returned duplicates
    const dedupe = (arr) => Array.from(new Set((arr || []).map(s => String(s).trim()).filter(Boolean))).slice(0, 10);

    feedbackData.strengths = dedupe(feedbackData.strengths || []);
    feedbackData.improvements = dedupe(feedbackData.improvements || []);
    feedbackData.recommendations = dedupe(feedbackData.recommendations || []);
    feedbackData.technicalKnowledge = normalizedScores.technicalKnowledge;
    feedbackData.problemSolving = normalizedScores.problemSolving;
    feedbackData.communication = normalizedScores.communication;
    feedbackData.totalScore = total30;

    // Build conversation array
    const conversation = (questions || []).map((q, i) => ({
      question: q,
      answer: (userAnswers && userAnswers[i]) ? userAnswers[i] : ''
    }));

    // Persist feedback JSON to disk per interview
    const outDir = path.join(process.cwd(), 'feedback');
    try { if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true }); } catch(e){}
    const fileId = `${(effectiveUserId||'anon')}-${Date.now()}.json`;
    const outPath = path.join(outDir, fileId);
    try {
      fs.writeFileSync(outPath, JSON.stringify({
        userId: effectiveUserId,
        role: interviewForm.role,
        interviewType: interviewForm.interviewType,
        duration: interviewForm.duration,
        resumeSummary,
        conversation,
        feedback: feedbackData
      }, null, 2));
    } catch(e) {
      console.warn('Could not write feedback file:', e.message);
    }

    // Store feedback and conversation history in Firebase
    if (effectiveUserId) {
      try {
        const interviewData = {
          userId: effectiveUserId,
          timestamp: new Date(),
          resumeSummary,
          role: interviewForm.role,
          interviewType: interviewForm.interviewType,
          duration: interviewForm.duration,
          questions,
          userAnswers,
          conversation,
          feedback: feedbackData,
          scores: {
            technicalKnowledge: feedbackData.technicalKnowledge,
            problemSolving: feedbackData.problemSolving,
            communication: feedbackData.communication
          },
          totalScore: feedbackData.totalScore || 0,
          feedbackFile: outPath
        };

        // Add to Firestore
        await db.collection("interviews").add(interviewData);
      } catch (dbError) {
        console.error("Error storing interview data in Firebase:", dbError);
      }
    }

  res.json({
      aiFeedback: feedbackData.feedback,
      detailedAnalysis: feedbackData.feedback,
      strengths: feedbackData.strengths || [],
      improvements: feedbackData.improvements || [],
      recommendations: feedbackData.recommendations || [],
      scores: feedbackData.scores || {},
      totalScore: feedbackData.totalScore || 0,
      conversation
    });
  } catch (err) {
    console.error("Feedback generation error:", err);
    res.status(500).json({
      error: "Failed to generate feedback",
      aiFeedback: `Thank you for your interview. We're experiencing technical difficulties generating detailed feedback. Please try again later.`
    });
  }
});

app.get("/", (req, res) => {
  res.send("PrepMind backend running");
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

// This backend uses Ollama for local LLM inference
// No external API keys are required