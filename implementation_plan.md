# Alumni Networking System — Full-Stack Implementation Plan
## EPIC-ALUMNI-2026-AI-CORE

A comprehensive, full-featured alumni networking platform built as a Next.js PWA targeting Bangladeshi educational institutions with native MFS payment integration, AI mentorship matching, and offline-first architecture.

---

## Scope of This Build

This plan covers a **production-quality Next.js frontend application** with realistic mock data, fully interactive UI/UX for all major modules, and simulated backend behaviors (API stubs). The complete system will demonstrate all 18 requirements from the PRD in a visually stunning, interactive format.

> [!IMPORTANT]
> **Build Approach**: Since this is a frontend demonstration, we will build a Next.js PWA with:
> - Fully interactive UI for all screens and modules
> - Realistic mock data simulating real alumni records
> - Local state management simulating backend calls
> - Service Worker setup for PWA/offline capability
> - All navigation, routing, and page flows working end-to-end

---

## Proposed Changes

### Project Structure

```
alumnai-system/
├── app/                          # Next.js App Router
│   ├── layout.tsx                # Root layout with PWA meta
│   ├── page.tsx                  # Landing / login page
│   ├── dashboard/page.tsx        # Executive Command Center
│   ├── directory/page.tsx        # Alumni Directory & Search
│   ├── mentorship/page.tsx       # AI Mentorship Hub
│   ├── donations/page.tsx        # MFS Donation Engine
│   ├── events/page.tsx           # Event Management
│   ├── jobs/page.tsx             # Job Board
│   ├── analytics/page.tsx        # Executive Analytics Dashboard
│   ├── chapters/page.tsx         # Chapter Management
│   ├── profile/page.tsx          # Alumni Profile & ID Card
│   ├── news/page.tsx             # News & Story Feed
│   ├── map/page.tsx              # Alumni Map
│   └── admin/page.tsx            # Admin Panel (RBAC)
├── components/
│   ├── layout/                   # Sidebar, Topbar, BottomNav
│   ├── dashboard/                # Metric tiles, charts
│   ├── directory/                # Search, profile cards
│   ├── mentorship/               # Matching UI, request flow
│   ├── donations/                # Campaign cards, MFS modal
│   ├── events/                   # Event cards, QR tickets
│   ├── ui/                       # Shared design system components
│   └── charts/                   # Recharts wrappers
├── lib/
│   ├── mock-data.ts              # Comprehensive mock datasets
│   ├── types.ts                  # TypeScript interfaces
│   └── utils.ts                  # Helpers
├── public/
│   ├── manifest.json             # PWA manifest
│   └── sw.js                     # Service Worker
└── styles/
    └── globals.css               # Design system variables
```

---

### Design System

**Color Palette:**
- Primary: `#6C63FF` (Electric Indigo)
- Accent: `#00D4AA` (Emerald Teal)
- Warning: `#FF8C42` (Amber)
- Background: `#0A0E1A` (Deep Navy)
- Surface: `#121829` / `#1A2235`
- Glass: `rgba(255,255,255,0.05)` with `backdrop-filter: blur(20px)`

**Typography:** Inter (Google Fonts)

**Visual Language:** Dark glassmorphism theme with purple/teal gradients, subtle particle/grid backgrounds, animated metric counters, and smooth page transitions.

---

### Pages & Components

#### [NEW] Root Layout & PWA Setup
- PWA manifest with theme colors
- Service Worker registration
- Global CSS design system (variables, glassmorphism utilities, animations)
- Sidebar navigation (desktop) + Bottom navigation (mobile)

#### [NEW] Login / Onboarding Page (`/`)
- Phone/Email OTP flow (animated multi-step)
- SIS match animation
- Role selection (Alumni, Student, Admin)
- Institution branding preview

#### [NEW] Executive Dashboard (`/dashboard`)
- 4 animated KPI metric tiles (Alumni count, Funds, Mentorships, Events)
- 12-month engagement trend chart (Recharts)
- Donation funnel chart
- Real-time pending verification queue (right panel)
- Broadcast alert button
- Multi-tenant switcher in topbar

#### [NEW] Alumni Directory (`/directory`)
- Semantic search bar with AI prompt ("Ask ConnectAI...")
- Voice input button
- Filter chips: Grad Year, Faculty, Degree, Location, Mentorship
- Alumni profile cards with verified badges, company logos
- Connect / Request Mentorship CTA buttons
- Offline indicator

#### [NEW] AI Mentorship Hub (`/mentorship`)
- Active connections list with health score
- Mentor matching algorithm visualization (radar chart of 6 criteria)
- Socratic AI prompt assistant for request drafting
- Pending requests with 5-day expiry countdown
- Mentee quota tracker

#### [NEW] MFS Donation Engine (`/donations`)
- Campaign cards with real-time progress bars (WebSocket simulation)
- Gateway selector (bKash, Nagad, Rocket, Card) with logos
- Fund tier selection
- Animated payment modal with PIN/OTP step
- PDF receipt preview
- Campaign ledger view

#### [NEW] Event Management (`/events`)
- Event grid with status badges
- Event creation form
- QR ticket generation
- Check-in scanner interface
- Capacity gauge (real-time)
- MFS payment integration for tickets

#### [NEW] Job Board (`/jobs`)
- Job listings with alumni company badges
- Internship drives section
- Resume upload interface
- Referral request workflow
- Alumni-only closed-loop badge

#### [NEW] Analytics Dashboard (`/analytics`)
- Multi-tab analytics: Engagement, Donations, Events, Mentorship
- Geographic heatmap (SVG-based world/Bangladesh map)
- Export to PDF/Excel buttons
- Offline-cached data indicator

#### [NEW] Chapter Management (`/chapters`)
- Hierarchical chapter tree (Regional → Batch → Interest)
- Chapter creation self-service flow
- Moderation tools
- Member management

#### [NEW] Alumni Profile & Digital ID Card (`/profile`)
- Profile edit form
- Digital Alumni ID Card (Apple/Google Wallet style)
- QR code with anti-spoofing
- Career timeline
- DSAR export (JSON/CSV) button
- Consent management panel

#### [NEW] News Feed (`/news`)
- Institutional announcements
- Alumni spotlights
- Rich media support
- Moderation status badges

#### [NEW] Alumni Map (`/map`)
- Privacy-preserving clustered map
- Global alumni density visualization
- Chapter pins
- Opt-in location sharing toggle

#### [NEW] Admin Panel (`/admin`)
- RBAC matrix visual (the full 9×9 table from PRD)
- User verification queue
- Role assignment UI
- Audit log timeline
- Compliance vault status

---

## Key Libraries

| Library | Purpose |
|---|---|
| `next` (v15) | Framework & App Router |
| `recharts` | Charts & analytics |
| `framer-motion` | Animations & transitions |
| `lucide-react` | Icon library |
| `qrcode.react` | QR code generation |
| `react-leaflet` | Map (alumni geographic view) |
| `react-hook-form` | Forms |
| `zustand` | Client state management |

---

## Verification Plan

### Automated
- `npm run build` — Confirm zero TypeScript errors and successful production build

### Manual
- Navigate all routes and verify all pages render correctly
- Test mobile responsive layout on narrow viewports
- Verify PWA manifest loads
- Confirm charts, animations, and interactive modals function
- Verify dark glassmorphism design system is consistent across all pages
