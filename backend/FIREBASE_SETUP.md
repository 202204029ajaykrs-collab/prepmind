# Firebase Admin SDK Setup Guide

## Step 1: Create Service Account

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your project: `prepmind-bb3b1`
3. Go to Project Settings (gear icon) → Service Accounts
4. Click "Generate new private key"
5. Download the JSON file

## Step 2: Update Service Account File

1. Replace the content in `firebase-service-account.json` with your downloaded JSON
2. Make sure the file contains:
   - `project_id`: "prepmind-bb3b1"
   - `private_key`: Your actual private key
   - `client_email`: Your service account email
   - Other required fields

## Step 3: Test the Setup

```bash
cd backend
node test-gemini.js
```

## Alternative: Use Default Credentials

If you don't want to use a service account file, you can:

1. Set the environment variable: `GOOGLE_APPLICATION_CREDENTIALS`
2. Or use `gcloud auth application-default login`
3. The app will fallback to default credentials automatically

## Security Note

- Never commit the service account JSON file to version control
- Add `firebase-service-account.json` to your `.gitignore`
- Use environment variables in production


[text](firebase-service-account.json)


  
