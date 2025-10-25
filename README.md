# 🎯 PrepMind - AI Interview Preparation Platform

A comprehensive AI-powered interview preparation platform that helps users practice interviews using their resume and AI-generated questions.

## ✨ Features

### 🤖 AI-Powered Interview Simulation
- **Intelligent Question Generation**: Uses Google Gemini AI to generate role-specific questions
- **Voice Recognition**: Real-time speech-to-text for natural interview experience
- **Text-to-Speech**: AI speaks questions aloud for immersive practice
- **Manual Input**: Fallback typing option for better accessibility

### 📄 Resume Analysis
- **PDF/DOC Upload**: Support for multiple document formats
- **AI-Powered Analysis**: Gemini AI extracts key skills and experience
- **Smart Summaries**: Comprehensive resume insights and highlights

### 📊 Performance Analytics
- **Real-time Feedback**: AI analyzes interview performance
- **Progress Tracking**: Historical interview data and improvements
- **Personalized Insights**: Tailored suggestions based on performance
- **Visual Analytics**: Beautiful charts and progress indicators

### 🎨 Modern UI/UX
- **Material-UI Design**: Clean, responsive interface
- **Real-time Notifications**: Toast messages and alerts
- **Progress Indicators**: Visual feedback for all operations
- **Mobile Responsive**: Works on all device sizes

## 🚀 Quick Start

### Prerequisites
- Node.js (v16 or higher)
- Google Gemini API key
- Firebase project

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd PrepMind
   ```

2. **Install dependencies**
   ```bash
   # Backend
   cd backend
   npm install
   
   # Frontend
   cd ../frontend
   npm install
   ```

3. **Environment Setup**
   ```bash
   # Backend
   cd backend
   cp .env.example .env
   # Edit .env with your API keys
   ```

4. **Configure Firebase**
   - Follow the guide in `backend/FIREBASE_SETUP.md`
   - Set up your Firebase service account

5. **Start the application**
   ```bash
   # Terminal 1 - Backend
   cd backend
   npm start
   
   # Terminal 2 - Frontend
   cd frontend
   npm start
   ```

6. **Access the application**
   - Open http://localhost:3000 in your browser
   - Sign in with Google
   - Upload your resume and start practicing!

## 🔧 Configuration

### Environment Variables

Create a `.env` file in the `backend` directory:

```env
# Gemini API Configuration
GEMINI_API_KEY=your_gemini_api_key_here

# Server Configuration
PORT=5000
NODE_ENV=development

# Firebase Configuration (optional)
FIREBASE_PROJECT_ID=prepmind-bb3b1
```

### API Keys Setup

1. **Gemini API Key**
   - Visit: https://makersuite.google.com/app/apikey
   - Create a new API key
   - Add it to your `.env` file

2. **Firebase Setup**
   - Create a Firebase project
   - Enable Authentication and Firestore
   - Configure Google Sign-in
   - Set up service account (see `backend/FIREBASE_SETUP.md`)

## 📱 Usage Guide

### 1. Resume Upload
- Click "Upload Resume" button
- Select PDF, DOC, or DOCX file (max 5MB)
- Wait for AI analysis to complete
- Review the generated summary

### 2. Interview Setup
- Choose your target role
- Select interview type (Technical/HR)
- Set duration (10/15/20 minutes)
- Click "Generate Questions"

### 3. Interview Practice
- Click "Start Interview Session"
- Listen to AI questions
- Answer using voice or typing
- Skip questions if needed
- Complete all questions

### 4. Review Feedback
- Submit your self-assessment
- Receive AI-powered feedback
- View performance analytics
- Track improvement over time

## 🏗️ Architecture

### Backend (Node.js/Express)
- **API Endpoints**: RESTful API for all operations
- **AI Integration**: Google Gemini for question generation and analysis
- **File Processing**: PDF parsing and text extraction
- **Database**: Firebase Firestore for data persistence
- **Authentication**: Firebase Admin SDK

### Frontend (React)
- **UI Framework**: Material-UI components
- **State Management**: React hooks and context
- **Authentication**: Firebase Auth with Google Sign-in
- **Voice Processing**: Web Speech API
- **Responsive Design**: Mobile-first approach

### AI Features
- **Question Generation**: Context-aware interview questions
- **Resume Analysis**: Intelligent skill extraction
- **Performance Feedback**: Comprehensive interview analysis
- **Personalization**: Tailored recommendations

## 🔒 Security Features

- **Input Validation**: Server-side validation for all inputs
- **File Type Validation**: Secure file upload handling
- **CORS Protection**: Configured cross-origin policies
- **Error Handling**: Graceful error management
- **Data Privacy**: Secure user data handling

## 📊 Performance Features

- **Loading States**: Visual feedback during operations
- **Progress Tracking**: Real-time progress indicators
- **Error Recovery**: Automatic retry mechanisms
- **Optimized Queries**: Efficient database operations
- **Caching**: Smart data caching strategies

## 🛠️ Development

### Project Structure
```
PrepMind/
├── backend/
│   ├── index.js              # Main server file
│   ├── package.json          # Backend dependencies
│   ├── .env                  # Environment variables
│   └── uploads/              # File upload directory
├── frontend/
│   ├── src/
│   │   ├── App.js           # Main app component
│   │   ├── Dashboard.js     # Main dashboard
│   │   ├── Login.js         # Authentication
│   │   └── firebase.js      # Firebase config
│   └── package.json         # Frontend dependencies
└── README.md                # This file
```

### Available Scripts

**Backend:**
```bash
npm start          # Start development server
npm test           # Run tests
```

**Frontend:**
```bash
npm start          # Start development server
npm build          # Build for production
npm test           # Run tests
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License.

## 🆘 Support

For support and questions:
- Check the documentation
- Review the Firebase setup guide
- Open an issue on GitHub

## 🔮 Future Enhancements

- [ ] Video interview simulation
- [ ] Multi-language support
- [ ] Advanced analytics dashboard
- [ ] Interview scheduling
- [ ] Company-specific question banks
- [ ] Mobile app development
- [ ] Integration with job boards
- [ ] Advanced AI coaching

---

**Made with ❤️ for better interview preparation**
# prepmind
# prepmind
# prepmind
