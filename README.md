# Lahel Vakkachan Discord Bot

Lahel Vakkachan is a modular, production-ready Discord bot designed for student communities, hackathon teams, startups, and software development teams. It automates team management by handling tasks, deadlines, reminders, meetings, and reports directly in Discord, with full Google Meet and Google Calendar integrations.

## Core Features
- **📋 Task Management**: Create, update, complete, and delete tasks with priority levels, assignees, progress notes, and change histories.
- **⏰ Smart Reminder System**: Automatically ping assigned users and roles two days before deadlines, daily after deadlines (if overdue), and escalate unresolved overdue tasks to team leaders.
- **⚙️ Server Setup (`/setup`)**: Configure administrator, team leader, and member roles alongside default notification channels, storing configurations in MongoDB.
- **👥 Team Management**: Build sub-teams, add/remove members, and list configurations.
- **📅 Meeting Scheduling (`/meet`)**: Schedule (`create`), update (`edit`), delete (`cancel`), and trace (`list`) team meetings with full Google Calendar event & Google Meet link generations. Reminders are sent 1d, 1h, and 10m before start.
- **📊 Metric Dashboard**: Run `/dashboard` to query metrics on pending, completed, overdue tasks, and upcoming meetings.
- **📈 Automated Reports**: Schedules cron jobs for daily summaries, weekly productivity stats, and monthly overviews.
- **⚡ System Utilities**:
  - `/ping`: Test bot responsiveness, roundtrip latency, and WebSocket API latency.

---

## Technical Architecture & Setup

### Prerequisites
- **Node.js** v18+
- **MongoDB** instance
- **Google Cloud Console Project** with Google Calendar API enabled, a Service Account created, and credentials shared with the target calendar.

### Configuration
1. Clone the repository.
2. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
3. Set your Discord bot token, Client ID, MongoDB URI, and Google Service Account credentials.
4. Share your Google Calendar (the ID configured in `GOOGLE_CALENDAR_ID` or your main calendar) with the service account email (e.g. `your-service-account-email@your-project.iam.gserviceaccount.com`) and grant it permission to "Make changes to events".

### Installation & Execution
```bash
# Install dependencies
npm install

# Deploy Discord Slash Commands to Guild/Global
npm run deploy

# Start the bot
npm start
```

### Docker
```bash
docker build -t lahel-vakkachan-bot .
docker run --env-file .env lahel-vakkachan-bot
```
