import React, { useEffect, useState, useRef } from "react";
import { auth, db } from "./firebase";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { collection, getDocs, query, where } from "firebase/firestore";
import { 
  Button, 
  Card, 
  CardContent, 
  Typography, 
  Box, 
  Grid, 
  Paper,
  Chip,
  LinearProgress,
  Alert,
  Snackbar,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Divider
} from "@mui/material";
import { 
  Upload as UploadIcon, 
  Mic as MicIcon, 
  Keyboard as KeyboardIcon,
  SkipNext as SkipIcon,
  Stop as StopIcon,
  Assessment as AnalyticsIcon,
  History as HistoryIcon
} from "@mui/icons-material";
import axios from "axios";

function Dashboard() {
  const [user, setUser] = useState(null);
  const [history, setHistory] = useState([]);
  const [resumeSummary, setResumeSummary] = useState(null);
  const [showInterviewForm, setShowInterviewForm] = useState(false);
  const [interviewForm, setInterviewForm] = useState({
    role: "",
    interviewType: "Technical",
    duration: 10
  });
  const [questions, setQuestions] = useState([]);
  const [interviewActive, setInterviewActive] = useState(false);
  const [currentQuestionIdx, setCurrentQuestionIdx] = useState(0);
  const [aiTranscription, setAiTranscription] = useState("");
  const [userTranscription, setUserTranscription] = useState("");
  const [userAnswers, setUserAnswers] = useState([]);
  const [showFeedbackForm, setShowFeedbackForm] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [aiFeedback, setAiFeedback] = useState("");
  const [analytics, setAnalytics] = useState(null);
  const [manualAnswer, setManualAnswer] = useState("");
  const [showManualInput, setShowManualInput] = useState(false);
  const [timer, setTimer] = useState(0);
  const [timerActive, setTimerActive] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [questionStartTime, setQuestionStartTime] = useState(null);
  const [answerTimeLimit, setAnswerTimeLimit] = useState(60); // 60 seconds per question
  const [loading, setLoading] = useState(false);
  const [snackbar, setSnackbar] = useState({ open: false, message: "", severity: "info" });
  const [uploadProgress, setUploadProgress] = useState(0);
  const [detailedFeedback, setDetailedFeedback] = useState(null);
  const [selectedInterview, setSelectedInterview] = useState(null);
  const [historySortKey, setHistorySortKey] = useState("date"); // 'date' | 'score' | 'duration'
  const [historySortOrder, setHistorySortOrder] = useState("desc"); // 'asc' | 'desc'
  const [historyFilterRole, setHistoryFilterRole] = useState("");

  const synth = window.speechSynthesis;
  const recognitionRef = useRef(null);
  const lastSpokenRef = useRef(null);
  const silenceMonitorRef = useRef(null);
  const answerSubmittedRef = useRef(false);
  const lastTranscriptRef = useRef("");
  const recognitionRestartCountRef = useRef(0);
  const [autoSubmitCountdown, setAutoSubmitCountdown] = useState(0);
  const silenceTimeoutSeconds = 10; // auto-submit after 10s silence
  const MAX_RESTARTS = 4; // how many times to auto-restart recognition if the browser stops it

  const showSnackbar = (message, severity = "info") => {
    setSnackbar({ open: true, message, severity });
  };

  const handleCloseSnackbar = () => {
    setSnackbar({ ...snackbar, open: false });
  };

  // We create a fresh SpeechRecognition instance each time we start listening
  // and store it in a ref so we can stop/cleanup reliably.

  const speakAIQuestion = (text) => {
    setAiTranscription(text);
    const utter = new window.SpeechSynthesisUtterance(text);
    utter.onend = () => {
      // After question is spoken, wait 2 seconds then start listening
      setTimeout(() => {
        startAnswering();
      }, 2000);
    };
    synth.speak(utter);
  };

  const startAnswering = () => {
    // Reset submit guard
    answerSubmittedRef.current = false;
    setQuestionStartTime(Date.now());
    setUserTranscription("");
    setShowManualInput(false);
    setIsListening(true);

    if (!('webkitSpeechRecognition' in window)) {
      setShowManualInput(true);
      setIsListening(false);
      return;
    }
    // Helper to create/start a recognition instance without resetting UX state
    const createRecognitionInstance = () => {
      try {
        recognitionRestartCountRef.current = recognitionRestartCountRef.current || 0;
        const rec = new window.webkitSpeechRecognition();
        rec.continuous = true; // keep listening across pauses
        rec.interimResults = true; // show live transcription
        rec.lang = 'en-US';
        rec.maxAlternatives = 1;

        recognitionRef.current = rec;
        lastSpokenRef.current = Date.now();
        // reset last transcript for this question
        lastTranscriptRef.current = "";

        rec.onresult = (event) => {
          let interim = '';
          let final = '';
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const r = event.results[i];
            if (r.isFinal) final += r[0].transcript;
            else interim += r[0].transcript;
          }
          const combined = (final + ' ' + interim).trim();
          if (combined) {
            lastTranscriptRef.current = combined;
            setUserTranscription(combined);
          }
          lastSpokenRef.current = Date.now();
          // reset restart counter on successful speech
          recognitionRestartCountRef.current = 0;
        };

        rec.onerror = (event) => {
          console.log('Speech recognition error:', event.error);
          if (event.error === 'no-speech' || event.error === 'audio-capture') {
            setUserTranscription('No speech detected. Please type your answer.');
          } else if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
            setUserTranscription('Microphone access blocked. Please allow microphone or type your answer.');
          } else {
            setUserTranscription('Could not recognize speech. Please type your answer.');
          }
          setShowManualInput(true);
          setIsListening(false);
          if (silenceMonitorRef.current) { clearInterval(silenceMonitorRef.current); }
          recognitionRef.current = null;
        };

        rec.onend = () => {
          // Some browsers stop recognition after short periods of silence.
          // If we still want to listen, try to restart a few times.
          recognitionRef.current = null;
          if (!answerSubmittedRef.current && isListening) {
            if ((recognitionRestartCountRef.current || 0) < MAX_RESTARTS) {
              recognitionRestartCountRef.current = (recognitionRestartCountRef.current || 0) + 1;
              // small delay and restart
              setTimeout(() => {
                if (isListening && !answerSubmittedRef.current) {
                  createRecognitionInstance();
                  try { if (recognitionRef.current) recognitionRef.current.start(); } catch(e){}
                }
              }, 300);
            } else {
              // Give up and auto-submit after short grace
              setTimeout(() => {
                if (!answerSubmittedRef.current) submitCurrentAnswer();
              }, 300);
            }
          }
        };

        try { rec.start(); } catch (e) { console.warn('recognition.start failed', e); }
      } catch (err) {
        console.warn('SpeechRecognition not available or init failed', err);
        setShowManualInput(true);
        setIsListening(false);
        recognitionRef.current = null;
      }
    };

    // create and start recognition
    recognitionRestartCountRef.current = 0;
    createRecognitionInstance();

    // Start silence monitor: auto-submit after `silenceTimeoutSeconds` of no new speech
    if (silenceMonitorRef.current) clearInterval(silenceMonitorRef.current);
    setAutoSubmitCountdown(silenceTimeoutSeconds);
    silenceMonitorRef.current = setInterval(() => {
      if (!lastSpokenRef.current) return;
      const elapsed = Date.now() - lastSpokenRef.current;
      const remaining = Math.max(0, Math.ceil((silenceTimeoutSeconds * 1000 - elapsed) / 1000));
      setAutoSubmitCountdown(remaining);
      // Trigger auto-submit when countdown reaches zero regardless of `isListening` state.
      if (elapsed >= silenceTimeoutSeconds * 1000 && !answerSubmittedRef.current) {
        submitCurrentAnswer();
      }
    }, 250);
  };

  const submitCurrentAnswer = () => {
    // Prevent double submit
    if (answerSubmittedRef.current) return;
    answerSubmittedRef.current = true;

  // Stop recognition and monitors
  try { if (recognitionRef.current) recognitionRef.current.stop(); } catch(e){}
  if (silenceMonitorRef.current) { clearInterval(silenceMonitorRef.current); silenceMonitorRef.current = null; }
  setAutoSubmitCountdown(0);

    setIsListening(false);

  // Prefer the most recent transcript captured in the onresult handler (ref) — this avoids
  // missing a final result when autosubmit fires before React state updates propagate.
  const candidate = (lastTranscriptRef.current && lastTranscriptRef.current.trim()) ? lastTranscriptRef.current.trim() : (userTranscription && userTranscription.trim()) ? userTranscription.trim() : "";
  const answer = candidate || "No answer provided";
  setUserTranscription(answer);
  setUserAnswers(prev => [...prev, answer]);

    // move to next question after small delay
    setTimeout(() => {
      moveToNextQuestion();
      answerSubmittedRef.current = false;
    }, 300);
  };

  const moveToNextQuestion = () => {
        // Clear any leftover countdown/monitors and last transcript
        if (silenceMonitorRef.current) { clearInterval(silenceMonitorRef.current); silenceMonitorRef.current = null; }
        setAutoSubmitCountdown(0);
        lastTranscriptRef.current = "";
        if (currentQuestionIdx + 1 < questions.length) {
          setCurrentQuestionIdx(currentQuestionIdx + 1);
        } else {
          setInterviewActive(false);
          setShowFeedbackForm(true);
        }
  };

  const skipQuestion = () => {
    setUserTranscription("Skipped");
    setUserAnswers(prev => [...prev, "Skipped"]);
    setShowManualInput(false);
    setIsListening(false);
    try { if (recognitionRef.current) recognitionRef.current.stop(); } catch(e){}
    moveToNextQuestion();
  };

  const handleManualAnswerSubmit = (e) => {
    e.preventDefault();
    if (manualAnswer.trim() === "") return;
    // prevent duplicate submissions
    if (answerSubmittedRef.current) return;
    answerSubmittedRef.current = true;

  // stop recognition if running
  try { if (recognitionRef.current) recognitionRef.current.stop(); } catch(e){}

    setUserTranscription(manualAnswer.trim());
    setUserAnswers(prev => [...prev, manualAnswer.trim()]);
    setManualAnswer("");
    setShowManualInput(false);
    setIsListening(false);

    // Move immediately to next question
    setTimeout(() => {
      moveToNextQuestion();
      answerSubmittedRef.current = false;
    }, 300);
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        fetchHistory(currentUser.uid);
        fetchAnalytics(currentUser.uid);
      }
    });
    return () => {
      unsubscribe();
      // Cleanup on unmount
      try { if (recognitionRef.current) recognitionRef.current.stop(); } catch(e){}
      synth.cancel();
      if (silenceMonitorRef.current) {
        clearInterval(silenceMonitorRef.current);
        silenceMonitorRef.current = null;
      }
    };
  }, []);

  // Accessibility: when opening the details Dialog, ensure any previously focused
  // element is blurred so that when MUI sets aria-hidden on the background we do
  // not keep focus inside an aria-hidden tree (this triggers browser accessibility warnings).
  useEffect(() => {
    if (selectedInterview) {
      try {
        const active = document.activeElement;
        if (active && typeof active.blur === 'function') active.blur();
      } catch (e) {
        // ignore
      }
    }
  }, [selectedInterview]);

  const fetchHistory = async (uid) => {
    const q = query(collection(db, "interviewHistory"), where("uid", "==", uid));
    const querySnapshot = await getDocs(q);
    setHistory(querySnapshot.docs.map(doc => doc.data()));
  };

  const fetchAnalytics = async (uid) => {
    try {
      const res = await axios.get(`http://localhost:5000/api/userAnalytics?uid=${uid}`);
      setAnalytics(res.data);
    } catch (err) {
      setAnalytics(null);
    }
  };

  const handleSignOut = async () => {
    await signOut(auth);
    window.location.href = "/";
  };

  const handleResumeUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    // Validate file type
    const allowedTypes = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    if (!allowedTypes.includes(file.type)) {
      showSnackbar("Please upload a PDF or Word document", "error");
      return;
    }
    
    // Validate file size (5MB limit)
    if (file.size > 5 * 1024 * 1024) {
      showSnackbar("File size must be less than 5MB", "error");
      return;
    }
    
    setLoading(true);
    setUploadProgress(0);
    
    const formData = new FormData();
    formData.append("resume", file);
    formData.append("uid", user.uid);
    
    try {
      // Simulate progress
      const progressInterval = setInterval(() => {
        setUploadProgress(prev => Math.min(prev + 10, 90));
      }, 200);
      
      const res = await axios.post("http://localhost:5000/api/uploadResume", formData, {
        headers: { "Content-Type": "multipart/form-data" }
      });
      
      clearInterval(progressInterval);
      setUploadProgress(100);
      setResumeSummary(res.data.summary);
      showSnackbar("Resume uploaded and analyzed successfully!", "success");
    } catch (err) {
      console.error("Resume upload error:", err);
      showSnackbar("Resume upload failed: " + (err.response?.data?.error || err.message), "error");
    } finally {
      setLoading(false);
      setUploadProgress(0);
    }
  };

  const handleInterviewFormChange = (e) => {
    setInterviewForm({
      ...interviewForm,
      [e.target.name]: e.target.value
    });
  };

  const handleInterviewStart = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await axios.post("http://localhost:5000/api/generateQuestions", {
        resumeSummary,
        ...interviewForm
      });
      setQuestions(res.data.questions);
      setShowInterviewForm(false);
      setTimer(parseInt(interviewForm.duration) * 60); // duration in seconds
      setTimerActive(true);
      showSnackbar(`Generated ${res.data.questions.length} interview questions!`, "success");
    } catch (err) {
      console.error("Question generation error:", err);
      showSnackbar("Failed to generate interview questions: " + (err.response?.data?.error || err.message), "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let interval;
    if (timerActive && timer > 0) {
      interval = setInterval(() => {
        setTimer((prev) => prev - 1);
      }, 1000);
    } else if (timer === 0 && timerActive) {
      setInterviewActive(false);
      setShowFeedbackForm(true);
      setTimerActive(false);
    }
    return () => clearInterval(interval);
  }, [timerActive, timer]);

  useEffect(() => {
    if (interviewActive && questions.length > 0 && currentQuestionIdx < questions.length && timer > 0) {
      // Only speak the question once when the question index changes
      speakAIQuestion(questions[currentQuestionIdx]);
    }
    // eslint-disable-next-line
  }, [interviewActive, currentQuestionIdx, questions]);

  const startInterviewSession = () => {
    setInterviewActive(true);
    setCurrentQuestionIdx(0);
    setUserAnswers([]);
    setAiTranscription("");
    setUserTranscription("");
    setShowManualInput(false);
    setIsListening(false);
    setTimer(parseInt(interviewForm.duration) * 60);
    setTimerActive(true);
  };

  const stopInterview = () => {
    setInterviewActive(false);
    setIsListening(false);
    setTimerActive(false);
    try { if (recognitionRef.current) recognitionRef.current.stop(); } catch(e){}
    synth.cancel();
  };

  const handleFeedbackSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      // Build conversation array [{question, answer}]
      const conversation = (questions || []).map((q, i) => ({
        question: q,
        answer: (userAnswers && userAnswers[i]) ? userAnswers[i] : ""
      }));

      const res = await axios.post("http://localhost:5000/api/feedback", {
        resumeSummary,
        interviewForm,
        questions,
        userAnswers,
        feedback,
        conversation,
        uid: user.uid
      });
      
      setAiFeedback(res.data.aiFeedback);
      setDetailedFeedback({
        detailedAnalysis: res.data.detailedAnalysis,
        scores: res.data.scores,
        totalScore: res.data.totalScore,
        strengths: res.data.strengths,
        improvements: res.data.improvements,
        recommendations: res.data.recommendations,
        conversation: res.data.conversation || conversation
      });
      
      setShowFeedbackForm(false);
      showSnackbar(`Interview completed! Your score: ${res.data.totalScore}/100`, "success");
      
      // Refresh analytics after feedback submission
      fetchAnalytics(user.uid);
    } catch (err) {
      console.error("Feedback submission error:", err);
      showSnackbar("Failed to get AI feedback: " + (err.response?.data?.error || err.message), "error");
    } finally {
      setLoading(false);
    }
  };

  if (!user) return (
    <Box display="flex" justifyContent="center" alignItems="center" minHeight="100vh">
      <LinearProgress sx={{ width: "50%" }} />
    </Box>
  );

  return (
    <Box sx={{ minHeight: "100vh", backgroundColor: "#f5f5f5" }}>
      {/* Header */}
      <Paper elevation={2} sx={{ p: 2, mb: 3 }}>
        <Box display="flex" justifyContent="space-between" alignItems="center">
          <Typography variant="h4" component="h1" color="primary">
            🎯 PrepMind
          </Typography>
          <Box display="flex" alignItems="center" gap={2}>
            <Typography variant="h6">Welcome, {user.displayName}</Typography>
            <Button variant="outlined" onClick={handleSignOut}>
              Sign Out
            </Button>
          </Box>
        </Box>
      </Paper>

      <Box sx={{ p: 3 }}>
        <Grid container spacing={3}>
          {/* Resume Upload Section */}
          <Grid size={{ xs: 12, md: 6 }}>
            <Card elevation={3}>
              <CardContent>
                <Box display="flex" alignItems="center" mb={2}>
                  <UploadIcon color="primary" sx={{ mr: 1 }} />
                  <Typography variant="h6">Resume Upload</Typography>
                </Box>
                
                {!resumeSummary ? (
                  <Box>
                    <input
                      type="file"
                      accept=".pdf,.doc,.docx"
                      onChange={handleResumeUpload}
                      style={{ display: "none" }}
                      id="resume-upload"
                    />
                    <label htmlFor="resume-upload">
                      <Button
                        variant="contained"
                        component="span"
                        startIcon={<UploadIcon />}
                        disabled={loading}
                        sx={{ mb: 2 }}
                      >
                        Upload Resume
                      </Button>
                    </label>
                    {loading && (
                      <Box sx={{ mt: 2 }}>
                        <LinearProgress variant="determinate" value={uploadProgress} />
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                          Analyzing resume... {uploadProgress}%
                        </Typography>
                      </Box>
                    )}
                    <Typography variant="body2" color="text.secondary">
                      Supported formats: PDF, DOC, DOCX (Max 5MB)
                    </Typography>
                  </Box>
                ) : (
                  <Box>
                    <Alert severity="success" sx={{ mb: 2 }}>
                      Resume uploaded successfully!
                    </Alert>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                      Resume Summary:
                    </Typography>
                    <Paper sx={{ p: 2, backgroundColor: "#f8f9fa", maxHeight: 200, overflow: "auto" }}>
                      <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
                        {resumeSummary}
                      </Typography>
                    </Paper>
                    <Button
                      variant="outlined"
                      onClick={() => setResumeSummary(null)}
                      sx={{ mt: 2 }}
                    >
                      Upload New Resume
                    </Button>
                  </Box>
                )}
              </CardContent>
            </Card>
          </Grid>

          {/* Interview Setup Section */}
          <Grid size={{ xs: 12, md: 6 }}>
            <Card elevation={3}>
              <CardContent>
                <Typography variant="h6" sx={{ mb: 2 }}>
                  🎤 AI Interview Setup
                </Typography>
                
                {!showInterviewForm && !questions.length && (
        <Button
          variant="contained"
          onClick={() => setShowInterviewForm(true)}
          disabled={!resumeSummary}
                    startIcon={<MicIcon />}
                    size="large"
                    sx={{ mb: 2 }}
        >
          Start AI Interview
        </Button>
                )}

      {showInterviewForm && (
                  <Box component="form" onSubmit={handleInterviewStart}>
                    <Grid container spacing={2}>
                      <Grid size={12}>
                        <Typography variant="subtitle2" gutterBottom>
                          Role
                        </Typography>
            <input
              type="text"
              name="role"
              value={interviewForm.role}
              onChange={handleInterviewFormChange}
                          placeholder="e.g., Software Engineer, Data Scientist"
              required
                          style={{
                            width: "100%",
                            padding: "8px",
                            borderRadius: "4px",
                            border: "1px solid #ccc"
                          }}
                        />
                      </Grid>
                      <Grid size={6}>
                        <Typography variant="subtitle2" gutterBottom>
                          Interview Type
                        </Typography>
            <select
              name="interviewType"
              value={interviewForm.interviewType}
              onChange={handleInterviewFormChange}
              required
                          style={{
                            width: "100%",
                            padding: "8px",
                            borderRadius: "4px",
                            border: "1px solid #ccc"
                          }}
            >
              <option value="Technical">Technical</option>
              <option value="HR">HR</option>
            </select>
                      </Grid>
                      <Grid size={6}>
                        <Typography variant="subtitle2" gutterBottom>
                          Duration
                        </Typography>
            <select
              name="duration"
              value={interviewForm.duration}
              onChange={handleInterviewFormChange}
              required
                          style={{
                            width: "100%",
                            padding: "8px",
                            borderRadius: "4px",
                            border: "1px solid #ccc"
                          }}
                        >
                          <option value={10}>10 minutes</option>
                          <option value={15}>15 minutes</option>
                          <option value={20}>20 minutes</option>
            </select>
                      </Grid>
                      <Grid size={12}>
                        <Button
                          type="submit"
                          variant="contained"
                          disabled={loading}
                          fullWidth
                        >
                          {loading ? "Generating Questions..." : "Generate Questions"}
          </Button>
                      </Grid>
                    </Grid>
                  </Box>
      )}

      {questions.length > 0 && !interviewActive && !showFeedbackForm && (
                  <Box sx={{ mt: 2 }}>
                    <Alert severity="info" sx={{ mb: 2 }}>
                      {questions.length} questions generated! Ready to start?
                    </Alert>
                    <Button
                      variant="contained"
                      onClick={startInterviewSession}
                      startIcon={<MicIcon />}
                      size="large"
                      fullWidth
                    >
            Start Interview Session
          </Button>
                  </Box>
                )}
              </CardContent>
            </Card>
          </Grid>
        </Grid>

        {/* Interview Active Section */}
      {interviewActive && (
          <Card elevation={4} sx={{ mt: 3, border: "2px solid #1976d2" }}>
            <CardContent>
              <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
                <Typography variant="h5" color="primary">
                  🎤 Interview in Progress
                </Typography>
                <Button 
                  variant="outlined" 
                  color="error"
                  startIcon={<StopIcon />}
                  onClick={stopInterview}
                >
                  Stop Interview
                </Button>
              </Box>
              
              <Grid container spacing={3}>
                <Grid size={{ xs: 12, md: 6 }}>
                  <Paper sx={{ p: 2, backgroundColor: "#f8f9fa" }}>
                    <Typography variant="h6" gutterBottom>
                      ⏰ Time Left: {Math.floor(timer / 60)}:{("0" + (timer % 60)).slice(-2)}
                    </Typography>
                    <LinearProgress 
                      variant="determinate" 
                      value={(timer / (parseInt(interviewForm.duration) * 60)) * 100}
                      sx={{ height: 8, borderRadius: 4 }}
                    />
                  </Paper>
                </Grid>
                
                <Grid size={{ xs: 12, md: 6 }}>
                  <Paper sx={{ p: 2, backgroundColor: "#e3f2fd" }}>
                    <Typography variant="h6" gutterBottom>
                      ❓ Question {currentQuestionIdx + 1} of {questions.length}
                    </Typography>
                    <Typography variant="body1">
                      {aiTranscription}
                    </Typography>
                  </Paper>
                </Grid>
              </Grid>
              
              {isListening && (
                <Alert severity="info" sx={{ mt: 2, mb: 2 }}>
                  <Box display="flex" alignItems="center">
                    <MicIcon sx={{ mr: 1 }} />
                    <Box>
                      <Typography variant="body1" sx={{ fontWeight: "bold" }}>
                        Listening... Speak now.
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Answer as you'd in a real interview: be concise, structure your response (Situation, Task, Action, Result), and speak clearly.
                      </Typography>
                    </Box>
                    <Box sx={{ ml: 2, display: 'flex', alignItems: 'center' }}>
                      {autoSubmitCountdown > 0 ? (
                        <Typography variant="h6" color="primary">{autoSubmitCountdown}s</Typography>
                      ) : null}
                    </Box>
                  </Box>
                </Alert>
              )}
              
              {userTranscription && (
                <Paper sx={{ p: 2, mt: 2, backgroundColor: "#e8f5e8" }}>
                  <Typography variant="h6" gutterBottom>
                    ✅ Your Answer:
                  </Typography>
                  <Typography variant="body1">
                    {userTranscription}
                  </Typography>
                </Paper>
              )}
              {userTranscription && isListening && (
                <Box sx={{ mt: 2, display: 'flex', gap: 1 }}>
                  <Button variant="contained" color="primary" onClick={submitCurrentAnswer}>
                    Submit Answer
                  </Button>
                  <Button variant="outlined" color="secondary" onClick={skipQuestion} startIcon={<SkipIcon />}>
                    Skip Question
                  </Button>
                </Box>
              )}
              
          {showManualInput && (
                <Paper sx={{ p: 2, mt: 2 }}>
                  <Typography variant="h6" gutterBottom>
                    ✍️ Type your answer:
                  </Typography>
                  <Box component="form" onSubmit={handleManualAnswerSubmit}>
                    <textarea
                value={manualAnswer}
                onChange={e => setManualAnswer(e.target.value)}
                      rows={4}
                      placeholder="Type your answer here..."
                required
                      style={{
                        width: "100%",
                        padding: "12px",
                        borderRadius: "8px",
                        border: "1px solid #ccc",
                        fontSize: "16px",
                        fontFamily: "inherit"
                      }}
                    />
                    <Box sx={{ mt: 2, display: "flex", gap: 1, flexWrap: "wrap" }}>
                      <Button type="submit" variant="contained" color="primary">
                Submit Answer
              </Button>
                      <Button 
                        type="button" 
                        variant="outlined" 
                        startIcon={<MicIcon />}
                        onClick={() => {
                          setShowManualInput(false);
                          startAnswering();
                        }}
                      >
                        Try Voice Again
                      </Button>
                      <Button 
                        type="button" 
                        variant="outlined" 
                        color="secondary"
                        startIcon={<SkipIcon />}
                        onClick={skipQuestion}
                      >
                        Skip Question
                      </Button>
                    </Box>
                  </Box>
                </Paper>
              )}
              
              {!isListening && !showManualInput && !userTranscription && (
                <Box sx={{ mt: 3, display: "flex", gap: 2, flexWrap: "wrap" }}>
                  <Button 
                    variant="contained" 
                    color="primary"
                    startIcon={<MicIcon />}
                    onClick={startAnswering}
                    size="large"
                  >
                    Start Answering
                  </Button>
                  <Button 
                    variant="outlined" 
                    startIcon={<KeyboardIcon />}
                    onClick={() => setShowManualInput(true)}
                    size="large"
                  >
                    Type Answer Instead
                  </Button>
                  <Button 
                    variant="outlined" 
                    color="secondary"
                    startIcon={<SkipIcon />}
                    onClick={skipQuestion}
                    size="large"
                  >
                    Skip Question
                  </Button>
                </Box>
              )}
            </CardContent>
          </Card>
        )}
        {/* Feedback Form */}
      {showFeedbackForm && (
          <Card elevation={3} sx={{ mt: 3 }}>
            <CardContent>
              <Typography variant="h5" gutterBottom>
                📝 Interview Feedback
              </Typography>
              <Box component="form" onSubmit={handleFeedbackSubmit}>
                <Typography variant="subtitle1" gutterBottom>
                  How do you think you performed in this interview?
                </Typography>
            <textarea
              value={feedback}
              onChange={e => setFeedback(e.target.value)}
              rows={4}
                  placeholder="Share your thoughts about your performance, areas you felt confident about, and areas for improvement..."
              required
                  style={{
                    width: "100%",
                    padding: "12px",
                    borderRadius: "8px",
                    border: "1px solid #ccc",
                    fontSize: "16px",
                    fontFamily: "inherit",
                    resize: "vertical"
                  }}
                />
                <Button 
                  type="submit" 
                  variant="contained" 
                  color="primary"
                  sx={{ mt: 2 }}
                  disabled={loading}
                >
                  {loading ? "Generating Feedback..." : "Submit Feedback"}
          </Button>
              </Box>
            </CardContent>
          </Card>
      )}

        {/* AI Feedback */}
      {aiFeedback && (
          <Card elevation={3} sx={{ mt: 3 }}>
            <CardContent>
              <Typography variant="h5" gutterBottom color="primary">
                🤖 AI Feedback
              </Typography>
              {/* Scores summary */}
              {detailedFeedback && (
                <Box sx={{ mb: 2, display: 'flex', gap: 2, alignItems: 'center' }}>
                  <Paper sx={{ p: 2, backgroundColor: '#e8f5e8', textAlign: 'center' }}>
                    <Typography variant="subtitle2">Technical</Typography>
                    <Typography variant="h5" color="primary">{detailedFeedback.scores?.technicalKnowledge ?? detailedFeedback.technicalKnowledge ?? '-'}/10</Typography>
                  </Paper>
                  <Paper sx={{ p: 2, backgroundColor: '#fff3e0', textAlign: 'center' }}>
                    <Typography variant="subtitle2">Problem Solving</Typography>
                    <Typography variant="h5" color="primary">{detailedFeedback.scores?.problemSolving ?? detailedFeedback.problemSolving ?? '-'}/10</Typography>
                  </Paper>
                  <Paper sx={{ p: 2, backgroundColor: '#e3f2fd', textAlign: 'center' }}>
                    <Typography variant="subtitle2">Communication</Typography>
                    <Typography variant="h5" color="primary">{detailedFeedback.scores?.communication ?? detailedFeedback.communication ?? '-'}/10</Typography>
                  </Paper>
                  <Paper sx={{ p: 2, backgroundColor: '#e8f5e8', textAlign: 'center', marginLeft: 'auto' }}>
                    <Typography variant="subtitle2">Total</Typography>
                    <Typography variant="h4" color="primary">{detailedFeedback.totalScore ?? 0}/30</Typography>
                  </Paper>
                </Box>
              )}

              {detailedFeedback && (
                <Box sx={{ mb: 3 }}>
                  <Paper sx={{ p: 2, backgroundColor: "#e8f5e8", mb: 2 }}>
                    <Typography variant="h6" color="primary" align="center">
                      Detailed Analysis & Summary
                    </Typography>
                  </Paper>
                  
                  <Grid container spacing={2} sx={{ mb: 2 }}>
                    {Object.entries(detailedFeedback.scores || {}).map(([category, score]) => (
                      <Grid size={{ xs: 6, md: 4 }} key={category}>
                        <Paper sx={{ p: 1, textAlign: "center" }}>
                          <Typography variant="body2" color="text.secondary">
                            {category.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}
                          </Typography>
                          <Typography variant="h6" color="primary">
                            {score}/10
                          </Typography>
                        </Paper>
                      </Grid>
                    ))}
                  </Grid>
                </Box>
              )}
              
              <Paper sx={{ p: 2, backgroundColor: "#f8f9fa" }}>
                <Typography variant="body1" sx={{ whiteSpace: "pre-wrap" }}>
                  {aiFeedback}
                </Typography>
              </Paper>
              
              {detailedFeedback && (
                <Box sx={{ mt: 2 }}>
                  <Typography variant="h6" gutterBottom>
                    📊 Detailed Analysis
                  </Typography>
                  <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", mb: 2 }}>
                    {detailedFeedback.detailedAnalysis}
                  </Typography>
                  {/* Conversation display */}
                  {(detailedFeedback.conversation || []).length > 0 && (
                    <Box sx={{ mb: 2 }}>
                      <Typography variant="h6" gutterBottom>
                        💬 Conversation
                      </Typography>
                      {(detailedFeedback.conversation || []).map((item, idx) => (
                        <Box key={idx} sx={{ mb: 2 }}>
                          <Paper sx={{ p: 2, backgroundColor: "#e3f2fd", mb: 1 }}>
                            <Typography variant="subtitle2" color="primary">
                              Question {idx + 1}
                            </Typography>
                            <Typography variant="body2">{item.question}</Typography>
                          </Paper>
                          <Paper sx={{ p: 2, backgroundColor: "#e8f5e8" }}>
                            <Typography variant="subtitle2" color="success.main">
                              Your Answer
                            </Typography>
                            <Typography variant="body2">{item.answer || "No answer provided"}</Typography>
                          </Paper>
                        </Box>
                      ))}
                    </Box>
                  )}
                  
                  <Grid container spacing={2}>
                    <Grid size={{ xs: 12, md: 4 }}>
                      <Paper sx={{ p: 2, backgroundColor: "#e8f5e8" }}>
                        <Typography variant="h6" gutterBottom>
                          ✅ Strengths
                        </Typography>
                        {detailedFeedback.strengths?.map((strength, idx) => (
                          <Typography key={idx} variant="body2">• {strength}</Typography>
                        ))}
                      </Paper>
                    </Grid>
                    
                    <Grid size={{ xs: 12, md: 4 }}>
                      <Paper sx={{ p: 2, backgroundColor: "#fff3e0" }}>
                        <Typography variant="h6" gutterBottom>
                          🔧 Improvements
                        </Typography>
                        {detailedFeedback.improvements?.map((improvement, idx) => (
                          <Typography key={idx} variant="body2">• {improvement}</Typography>
                        ))}
                      </Paper>
                    </Grid>
                    
                    <Grid size={{ xs: 12, md: 4 }}>
                      <Paper sx={{ p: 2, backgroundColor: "#e3f2fd" }}>
                        <Typography variant="h6" gutterBottom>
                          💡 Recommendations
                        </Typography>
                        {detailedFeedback.recommendations?.map((rec, idx) => (
                          <Typography key={idx} variant="body2">• {rec}</Typography>
                        ))}
                      </Paper>
                    </Grid>
                  </Grid>
                </Box>
              )}
            </CardContent>
          </Card>
        )}

        {/* Analytics Section */}
        <Grid container spacing={3} sx={{ mt: 2 }}>
          <Grid size={12}>
            <Card elevation={3}>
              <CardContent>
                <Box display="flex" alignItems="center" mb={2}>
                  <AnalyticsIcon color="primary" sx={{ mr: 1 }} />
                  <Typography variant="h5">Analytics & Insights</Typography>
                </Box>
                
      {analytics ? (
                  <Grid container spacing={3}>
                    {/* Score Overview */}
                    {analytics.averageScore > 0 && (
                      <Grid size={12}>
                        <Paper sx={{ p: 2, backgroundColor: "#e8f5e8" }}>
                          <Typography variant="h6" gutterBottom>
                            🏆 Overall Performance
                          </Typography>
                          <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
                            <Typography variant="h3" color="primary">
                              {analytics.averageScore}/100
                            </Typography>
                            <Box>
                              <Typography variant="body1">
                                Average Score across {analytics.totalInterviews} interviews
                              </Typography>
                              <Typography variant="body2" color="text.secondary">
                                Latest scores: {analytics.recentScores?.map(s => s.score).join(", ")}
                              </Typography>
                            </Box>
                          </Box>
                        </Paper>
                      </Grid>
                    )}
                    
                    {/* Score Breakdown */}
                    {analytics.scoreBreakdown && Object.keys(analytics.scoreBreakdown).length > 0 && (
                      <Grid size={12}>
                        <Paper sx={{ p: 2, backgroundColor: "#f8f9fa" }}>
                          <Typography variant="h6" gutterBottom>
                            📊 Score Breakdown
                          </Typography>
                          <Grid container spacing={1}>
                            {Object.entries(analytics.scoreBreakdown).map(([category, score]) => (
                              <Grid size={{ xs: 6, md: 3 }} key={category}>
                                <Box sx={{ textAlign: "center", p: 1 }}>
                                  <Typography variant="body2" color="text.secondary">
                                    {category.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}
                                  </Typography>
                                  <Typography variant="h6" color="primary">
                                    {score}/10
                                  </Typography>
                                </Box>
                              </Grid>
                            ))}
                          </Grid>
                        </Paper>
                      </Grid>
                    )}
                    
                    <Grid size={{ xs: 12, md: 6 }}>
                      <Paper sx={{ p: 2, backgroundColor: "#e8f5e8" }}>
                        <Typography variant="h6" gutterBottom>
                          📄 Resume Highlights
                        </Typography>
                        <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
                          {analytics.resumeHighlights}
                        </Typography>
                      </Paper>
                    </Grid>
                    
                    <Grid size={{ xs: 12, md: 6 }}>
                      <Paper sx={{ p: 2, backgroundColor: "#e3f2fd" }}>
                        <Typography variant="h6" gutterBottom>
                          📊 Performance Summary
                        </Typography>
                        <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
                          {analytics.performanceSummary}
                        </Typography>
                      </Paper>
                    </Grid>
                    
                    <Grid size={12}>
                      <Paper sx={{ p: 2, backgroundColor: "#fff3e0" }}>
                        <Typography variant="h6" gutterBottom>
                          💡 Improvement Suggestions
                        </Typography>
                        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
                          {(analytics.suggestions || []).map((suggestion, idx) => (
                            <Chip 
                              key={idx} 
                              label={suggestion} 
                              color="warning" 
                              variant="outlined"
                            />
                          ))}
                        </Box>
                      </Paper>
                    </Grid>
                    
                    {(analytics.pastInterviews || analytics.pastFeedback || []).length > 0 && (
                      <Grid size={12}>
                        <Paper sx={{ p: 2, backgroundColor: "#f3e5f5" }}>
                          <Typography variant="h6" gutterBottom>
                            📚 Past Interview History
                          </Typography>
                          {/* Controls */}
                          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
                            <Box>
                              <Typography variant="caption" color="text.secondary">Sort By</Typography>
                              <select
                                value={historySortKey}
                                onChange={e => setHistorySortKey(e.target.value)}
                                style={{ marginLeft: 8 }}
                              >
                                <option value="date">Date</option>
                                <option value="score">Score</option>
                                <option value="duration">Duration</option>
                              </select>
                              <select
                                value={historySortOrder}
                                onChange={e => setHistorySortOrder(e.target.value)}
                                style={{ marginLeft: 8 }}
                              >
                                <option value="desc">Desc</option>
                                <option value="asc">Asc</option>
                              </select>
                            </Box>
                            <Box>
                              <Typography variant="caption" color="text.secondary">Filter by Role</Typography>
                              <input
                                type="text"
                                placeholder="e.g., Java Developer"
                                value={historyFilterRole}
                                onChange={e => setHistoryFilterRole(e.target.value)}
                                style={{ marginLeft: 8, padding: 6, border: '1px solid #ccc', borderRadius: 4 }}
                              />
                            </Box>
                          </Box>
                          {(() => {
                            const list = (analytics.pastInterviews || analytics.pastFeedback || []).slice();
                            // filter
                            const filtered = historyFilterRole
                              ? list.filter(x => String(x.role||'').toLowerCase().includes(historyFilterRole.toLowerCase()))
                              : list;
                            // sort
                            const sorted = filtered.sort((a,b) => {
                              let av, bv;
                              if (historySortKey === 'score') {
                                av = a.totalScore || 0; bv = b.totalScore || 0;
                              } else if (historySortKey === 'duration') {
                                av = a.duration || 0; bv = b.duration || 0;
                              } else {
                                av = new Date(a.date || a.timestamp || 0).getTime();
                                bv = new Date(b.date || b.timestamp || 0).getTime();
                              }
                              return historySortOrder === 'asc' ? av - bv : bv - av;
                            });
                            return (
                              <>
                                {sorted.map((interview, idx) => (
                                  <Card key={idx} sx={{ mb: 2, cursor: "pointer" }} onClick={() => setSelectedInterview(interview)}>
                                    <CardContent>
                                      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                        <Box>
                                          <Typography variant="h6">
                                            {interview.role} - {(interview.duration !== undefined && interview.duration !== null) ? interview.duration : 'N/A'} minutes
                                          </Typography>
                                          <Typography variant="body2" color="text.secondary">
                                            Date: {interview.date || interview.timestamp || ''}
                                          </Typography>
                                          <Chip
                                            label={`Score: ${interview.totalScore ?? 0}/100`}
                                            color="primary"
                                            size="small"
                                            sx={{ mt: 1 }}
                                          />
                                        </Box>
                                        <Button variant="outlined" size="small">
                                          View Details
                                        </Button>
                                      </Box>
                                      {/* Resume Highlights & Suggestions preview */}
                                      {(interview.resumeSummary || (interview.improvements && interview.improvements.length)) && (
                                        <Box sx={{ mt: 2 }}>
                                          {interview.resumeSummary && (
                                            <Typography variant="body2" sx={{ mb: 1 }}>
                                              <strong>Highlights:</strong> {String(interview.resumeSummary).slice(0, 160)}{String(interview.resumeSummary).length > 160 ? '…' : ''}
                                            </Typography>
                                          )}
                                          {(interview.improvements && interview.improvements.length > 0) && (
                                            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                                              {interview.improvements.slice(0, 3).map((s, i) => (
                                                <Chip key={i} label={s} color="warning" size="small" variant="outlined" />
                                              ))}
                                            </Box>
                                          )}
                                        </Box>
                                      )}
                                    </CardContent>
                                  </Card>
                                ))}
                              </>
                            );
                          })()}
                        </Paper>
                      </Grid>
                    )}
                  </Grid>
                ) : (
                  <Alert severity="info">
                    No analytics available yet. Complete an interview to see your performance insights!
                  </Alert>
                )}
              </CardContent>
            </Card>
          </Grid>
        </Grid>

        {/* Interview Details Modal */}
        <Dialog 
          open={!!selectedInterview} 
          onClose={() => setSelectedInterview(null)}
          maxWidth="md"
          fullWidth
        >
          <DialogTitle>
            {/* Avoid nesting heading tags: DialogTitle defaults to an h2 element, so render inner typography as a div */}
            <Typography variant="h5" component="div">
              📋 Interview Details - {selectedInterview?.role}
            </Typography>
            <Typography variant="body2" color="text.secondary" component="div">
              {selectedInterview?.date} • {selectedInterview?.duration ?? 'N/A'} minutes • Score: {selectedInterview?.totalScore ?? 0}/100
            </Typography>
          </DialogTitle>
          <DialogContent>
            {selectedInterview && (
              <Box>
                {/* Resume Highlights and Suggestions */}
                {(selectedInterview.resumeSummary || (selectedInterview.improvements && selectedInterview.improvements.length)) && (
                  <Box sx={{ mb: 3 }}>
                    {selectedInterview.resumeSummary && (
                      <Paper sx={{ p: 2, backgroundColor: "#f8f9fa", mb: 2 }}>
                        <Typography variant="h6" gutterBottom>
                          📄 Resume Highlights
                        </Typography>
                        <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
                          {selectedInterview.resumeSummary}
                        </Typography>
                      </Paper>
                    )}
                    {(selectedInterview.improvements && selectedInterview.improvements.length > 0) && (
                      <Paper sx={{ p: 2, backgroundColor: "#fff3e0" }}>
                        <Typography variant="h6" gutterBottom>
                          💡 Improvement Suggestions
                        </Typography>
                        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
                          {selectedInterview.improvements.map((s, idx) => (
                            <Chip key={idx} label={s} color="warning" variant="outlined" />
                          ))}
                        </Box>
                      </Paper>
                    )}
                  </Box>
                )}
                {/* Score Breakdown */}
                {selectedInterview.scores && (
                  <Box sx={{ mb: 3 }}>
                    <Typography variant="h6" gutterBottom>
                      📊 Score Breakdown
                    </Typography>
                    <Grid container spacing={1}>
                      {Object.entries(selectedInterview.scores).map(([category, score]) => (
                        <Grid size={{ xs: 6, md: 3 }} key={category}>
                          <Paper sx={{ p: 1, textAlign: "center" }}>
                            <Typography variant="body2" color="text.secondary">
                              {category.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}
                            </Typography>
                            <Typography variant="h6" color="primary">
                              {score}/10
                            </Typography>
                          </Paper>
                        </Grid>
                      ))}
                    </Grid>
                  </Box>
                )}
                
                <Divider sx={{ my: 2 }} />
                
                {/* Questions and Answers - prefer conversation array if present */}
                <Typography variant="h6" gutterBottom>
                  💬 Interview Conversation
                </Typography>
                {(selectedInterview?.conversation || []).length > 0
                  ? selectedInterview.conversation.map((item, idx) => (
                      <Box key={idx} sx={{ mb: 3 }}>
                        <Paper sx={{ p: 2, backgroundColor: "#e3f2fd", mb: 1 }}>
                          <Typography variant="subtitle2" color="primary">
                            Question {idx + 1}:
                          </Typography>
                          <Typography variant="body1">
                            {item.question}
                          </Typography>
                        </Paper>
                        <Paper sx={{ p: 2, backgroundColor: "#e8f5e8" }}>
                          <Typography variant="subtitle2" color="success.main">
                            Your Answer:
                          </Typography>
                          <Typography variant="body1">
                            {item.answer || "No answer provided"}
                          </Typography>
                        </Paper>
                      </Box>
                    ))
                  : (selectedInterview?.questions || []).map((question, idx) => (
                      <Box key={idx} sx={{ mb: 3 }}>
                        <Paper sx={{ p: 2, backgroundColor: "#e3f2fd", mb: 1 }}>
                          <Typography variant="subtitle2" color="primary">
                            Question {idx + 1}:
                          </Typography>
                          <Typography variant="body1">
                            {question}
                          </Typography>
                        </Paper>
                        <Paper sx={{ p: 2, backgroundColor: "#e8f5e8" }}>
                          <Typography variant="subtitle2" color="success.main">
                            Your Answer:
                          </Typography>
                          <Typography variant="body1">
                            {selectedInterview.answers?.[idx] || "No answer provided"}
                          </Typography>
                        </Paper>
                      </Box>
                    ))}
                
                {/* Feedback */}
                {selectedInterview.feedback && (
                  <Box sx={{ mt: 3 }}>
                    <Divider sx={{ my: 2 }} />
                    <Typography variant="h6" gutterBottom>
                      🤖 AI Feedback
                    </Typography>
                    <Paper sx={{ p: 2, backgroundColor: "#f8f9fa" }}>
                      <Typography variant="body1" sx={{ whiteSpace: "pre-wrap" }}>
                        {selectedInterview.feedback}
                      </Typography>
                    </Paper>
                  </Box>
                )}
              </Box>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setSelectedInterview(null)}>
              Close
            </Button>
          </DialogActions>
        </Dialog>

        {/* Snackbar for notifications */}
        <Snackbar
          open={snackbar.open}
          autoHideDuration={6000}
          onClose={handleCloseSnackbar}
        >
          <Alert 
            onClose={handleCloseSnackbar} 
            severity={snackbar.severity}
            sx={{ width: '100%' }}
          >
            {snackbar.message}
          </Alert>
        </Snackbar>
      </Box>
    </Box>
  );
}
export default Dashboard;
