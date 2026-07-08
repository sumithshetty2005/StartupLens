import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Activity, Target, AlertTriangle, CheckCircle, ArrowRight, Zap, Users, TrendingUp, DollarSign, Shield, BarChart3, PieChart as PieChartIcon, Layers, Lock, Unlock, Menu, User, RefreshCw, Download, Home, Info, X, Search, BarChart2, Scale, Trash2, Pin, Plus, LogOut, ChevronLeft } from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend } from 'recharts';
import InteractiveCanvas from './InteractiveCanvas';
import { supabase } from '../lib/supabase';

const colors = {
    bg: 'bg-white text-[#111827]',
    card: 'brand-card bg-[#F0F0F0] text-[#111827] border border-[#C0C0C0] rounded-lg shadow-sm',
    cardHover: 'hover:translate-y-[-4px] hover:border-[#111827]/30 transition-all duration-300',
    accent: 'text-[#111827]',
    border: 'border-[#C0C0C0]',
    text: 'text-[#4B5563]',
    highlight: 'text-[#111827]',
    buttonPrimary: 'brand-btn-primary text-xs font-semibold',
    buttonSecondary: 'brand-btn-secondary text-xs font-semibold'
};

const COLORS = ['#111827', '#4B5563', '#334155', '#C0C0C0', '#9CA3AF', '#F0F0F0'];

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:7860';

const renderFormattedText = (text: string) => {
    if (!text) return null;
    
    // First, split by markdown links [label](url)
    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    const parts: any[] = [];
    let lastIndex = 0;
    let match;
    
    while ((match = linkRegex.exec(text)) !== null) {
        if (match.index > lastIndex) {
            parts.push(text.substring(lastIndex, match.index));
        }
        
        const linkText = match[1];
        const linkUrl = match[2];
        parts.push(
            <a 
                key={`link-${match.index}`} 
                href={linkUrl} 
                target="_blank" 
                rel="noopener noreferrer" 
                className="text-[#111827] underline decoration-2 underline-offset-2 hover:text-[#4B5563] font-bold"
            >
                {linkText}
            </a>
        );
        
        lastIndex = linkRegex.lastIndex;
    }
    
    if (lastIndex < text.length) {
        parts.push(text.substring(lastIndex));
    }
    
    // For each segment, split by bold tags **text** then single *text*
    return parts.map((part, partIdx) => {
        if (typeof part === 'string') {
            // First handle **bold**
            const boldParts = part.split('**');
            return boldParts.map((bp, bpIdx) => {
                if (bpIdx % 2 === 1) {
                    return <strong key={`bold-${partIdx}-${bpIdx}`} className="font-bold text-[#111827]">{bp}</strong>;
                }
                // Then handle *italic* — render without asterisks (as plain text, no italic style)
                const italicParts = bp.split('*');
                return italicParts.map((ip, ipIdx) => {
                    if (ipIdx % 2 === 1) {
                        // Strip the asterisks, render the text plainly
                        return ip;
                    }
                    return ip;
                });
            });
        }
        return part;
    });
};

const renderBoldText = renderFormattedText;


const renderSummaryAsBullets = (text: string) => {
    if (!text) return null;
    
    let cleanText = text.trim();
    if (cleanText.startsWith('"') && cleanText.endsWith('"')) {
        cleanText = cleanText.substring(1, cleanText.length - 1).trim();
    }
    
    let points: string[] = [];
    if (cleanText.includes('\n')) {
        points = cleanText.split('\n').map(p => p.trim()).filter(p => p.length > 0);
    } else {
        // Split by period followed by space, indicating sentence boundary
        points = cleanText.split(/\. (?=[A-Z])/).map(p => p.trim()).filter(p => p.length > 0);
        points = points.map((p, idx) => {
            if (!p.endsWith('.') && idx < points.length - 1) {
                return p + '.';
            }
            return p;
        });
    }
    
    // Clean bullet symbols from start
    points = points.map(p => p.replace(/^[-•*#\s\d.]+\s*/, '').trim());
    
    return (
        <ul className="space-y-4 list-disc pl-5">
            {points.map((point, index) => (
                <li key={index} className="text-black/85 text-base leading-relaxed font-medium">
                    {renderFormattedText(point)}
                </li>
            ))}
        </ul>
    );
};

const currencySymbols = {
    USD: '$',
    INR: '₹',
    EUR: '€',
    GBP: '£'
};

const currencyRates = {
    USD: 1.0,
    INR: 83.5,
    EUR: 0.92,
    GBP: 0.79
};

const formatCurrency = (valStr: string, targetCurrency: 'USD' | 'INR' | 'EUR' | 'GBP') => {
    if (!valStr) return '';
    
    // Clean currency symbols from valStr
    let cleanVal = valStr.replace(/[$\u20B9\u20AC\u00A3]/g, '').trim();
    
    // Check if it's already a clean number, or has text suffix
    const match = cleanVal.match(/^([\d,.-]+)(.*)$/);
    if (!match) return valStr;
    
    const numStr = match[1].replace(/,/g, '');
    const num = parseFloat(numStr);
    const suffix = match[2];
    
    if (isNaN(num)) return valStr;
    
    const converted = num * currencyRates[targetCurrency];
    const symbol = currencySymbols[targetCurrency];
    
    let formattedNum = '';
    if (converted >= 1000) {
        formattedNum = Math.round(converted).toLocaleString();
    } else {
        formattedNum = converted % 1 === 0 ? converted.toString() : converted.toFixed(1);
    }
    
    return `${symbol}${formattedNum}${suffix}`;
};

interface DashboardProps {
    onBack: (target?: string) => void;
    user: any;
    isGuest: boolean;
    onLogout: () => void;
}

const Dashboard: React.FC<DashboardProps> = ({ onBack, user, isGuest, onLogout }) => {
    const [idea, setIdea] = useState('');
    const [industry, setIndustry] = useState('');
    const [loading, setLoading] = useState(false);
    const [data, setData] = useState<any>(null);
    const [error, setError] = useState('');
    const [isQuotaError, setIsQuotaError] = useState(false);
    const [customKey, setCustomKey] = useState('');
    const [failedStartupsData, setFailedStartupsData] = useState<any>(null);
    const [failedStartupsLoading, setFailedStartupsLoading] = useState(false);
    const [showPricing, setShowPricing] = useState(false);
    const [showMethodology, setShowMethodology] = useState(false);
    const [scrollProgress, setScrollProgress] = useState(0);
    const [currency, setCurrency] = useState<'USD' | 'INR' | 'EUR' | 'GBP'>('USD');
    const [showCurrencyTip, setShowCurrencyTip] = useState(false);
    const [geographicMarket, setGeographicMarket] = useState<'Global' | 'India' | 'USA' | 'Europe'>('Global');

    // Sidebar & History States
    const [history, setHistory] = useState<any[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
    const [showProfileDropdown, setShowProfileDropdown] = useState(false);

    // Agent Audit Log States
    const [logs, setLogs] = useState<string[]>([]);
    const [isLogsCollapsed, setIsLogsCollapsed] = useState(true);

    // Automatic scroll for terminal log monitor
    useEffect(() => {
        if (loading) {
            const el = document.getElementById('terminal-logs-container');
            if (el) {
                el.scrollTop = el.scrollHeight;
            }
        }
    }, [logs, loading]);

    // Dynamic Identicon SVG Generator (matches the green block style)

    const fetchHistory = useCallback(async () => {
        let localList: any[] = [];
        try {
            const stored = localStorage.getItem('startuplens_history');
            if (stored) {
                localList = JSON.parse(stored);
            }
        } catch (e) {
            console.error("Failed to read from localStorage:", e);
        }

        if (!user) {
            setHistory(localList);
            return;
        }

        const { data: list, error: err } = await supabase
            .from('analyses')
            .select('*')
            .order('pinned', { ascending: false })
            .order('created_at', { ascending: false });

        if (!err && list) {
            setHistory(list);
            try {
                localStorage.setItem('startuplens_history', JSON.stringify(list));
            } catch (e) {
                console.error("Failed to sync history to localStorage:", e);
            }
        } else {
            setHistory(localList);
        }
    }, [user]);

    useEffect(() => {
        fetchHistory();
    }, [fetchHistory]);

    // Click-outside listener for profile dropdown
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            const target = event.target as HTMLElement;
            if (!target.closest('.relative-dropdown')) {
                setShowProfileDropdown(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const saveAnalysisToSupabase = async (ideaText: string, indText: string, geoText: string, analysisResult: any, fsResult: any) => {
        const title = ideaText.trim().substring(0, 35) + (ideaText.trim().length > 35 ? '...' : '');
        const newRecord = {
            id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2),
            user_id: user?.id || 'guest',
            title,
            idea: ideaText,
            industry: indText,
            geographic_market: geoText,
            data: { analysisResult, fsResult },
            created_at: new Date().toISOString(),
            pinned: false
        };

        // 1. Save to local storage first (always succeeds)
        try {
            const stored = localStorage.getItem('startuplens_history');
            const currentList = stored ? JSON.parse(stored) : [];
            const updatedList = [newRecord, ...currentList];
            localStorage.setItem('startuplens_history', JSON.stringify(updatedList));
            setHistory(updatedList);
        } catch (e) {
            console.error("Failed to save to localStorage:", e);
        }

        // 2. Save to Supabase if logged in
        if (user) {
            const { error: err } = await supabase
                .from('analyses')
                .insert({
                    user_id: user.id,
                    title,
                    idea: ideaText,
                    industry: indText,
                    geographic_market: geoText,
                    data: { analysisResult, fsResult }
                });
            if (!err) {
                fetchHistory();
            } else {
                console.error("Error saving analysis to Supabase:", err);
            }
        }
    };

    const loadHistoryItem = (item: any) => {
        setIdea(item.idea);
        setIndustry(item.industry);
        setGeographicMarket(item.geographic_market);
        setData(item.data.analysisResult);
        setFailedStartupsData(item.data.fsResult);
        
        const timestamp = new Date(item.created_at || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        setLogs([
            `[${timestamp}] 📁 Restored archived analysis for "${item.idea}" in "${item.industry}" (${item.geographic_market}).`,
            `[${timestamp}] ✅ Restored failed startup case studies from RAG vector database.`,
            `[${timestamp}] 💾 Session data loaded successfully from saved database.`
        ]);
        setIsLogsCollapsed(true);
    };

    const handleNewAnalysis = () => {
        setIdea('');
        setIndustry('');
        setGeographicMarket('Global');
        setData(null);
        setFailedStartupsData(null);
        setError('');
        setIsQuotaError(false);
        setLogs([]);
    };

    const handleTogglePin = async (id: string, currentPinned: boolean, e: React.MouseEvent) => {
        e.stopPropagation();
        
        // Update local storage
        try {
            const stored = localStorage.getItem('startuplens_history');
            if (stored) {
                const list = JSON.parse(stored);
                const updated = list.map((item: any) => 
                    item.id === id ? { ...item, pinned: !currentPinned } : item
                );
                // Sort pinned first, then by date
                const sorted = updated.sort((a: any, b: any) => {
                    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
                    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
                });
                localStorage.setItem('startuplens_history', JSON.stringify(sorted));
                setHistory(sorted);
            }
        } catch (err) {
            console.error(err);
        }

        if (user) {
            const { error: err } = await supabase
                .from('analyses')
                .update({ pinned: !currentPinned })
                .eq('id', id);
            if (!err) {
                fetchHistory();
            }
        }
    };

    const handleDeleteHistoryItem = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation();

        // Update local storage
        try {
            const stored = localStorage.getItem('startuplens_history');
            if (stored) {
                const list = JSON.parse(stored);
                const updated = list.filter((item: any) => item.id !== id);
                localStorage.setItem('startuplens_history', JSON.stringify(updated));
                setHistory(updated);
            }
        } catch (err) {
            console.error(err);
        }

        if (user) {
            const { error: err } = await supabase
                .from('analyses')
                .delete()
                .eq('id', id);
            if (!err) {
                fetchHistory();
            }
        }
    };

    const filteredHistory = useMemo(() => {
        return history.filter(item => 
            item.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
            item.idea?.toLowerCase().includes(searchQuery.toLowerCase()) ||
            item.industry?.toLowerCase().includes(searchQuery.toLowerCase())
        );
    }, [history, searchQuery]);

    const PRESETS = [
        {
            title: "Food & Automation",
            concept: "An automated robotic coffee kiosk designed to serve premium espresso and custom specialty drinks in corporate office lobbies and airport hubs.",
            industry: "Accommodation and Food Services"
        },
        {
            title: "Social Rewards",
            concept: "A location-based social check-in application where users share photos and earn loyalty points for visiting retail shops with friends.",
            industry: "Information"
        },
        {
            title: "Meal Subscriptions",
            concept: "An organic, chef-prepared meal delivery subscription service delivering healthy dinner kits directly to suburban family homes daily.",
            industry: "Accommodation and Food Services"
        },
        {
            title: "Clothing Rental",
            concept: "A peer-to-peer fashion rental marketplace allowing users to lease premium designer dresses and accessories directly to and from each other.",
            industry: "Retail Trade"
        },
        {
            title: "Kids Games",
            concept: "An educational mobile game suite designed to teach elementary children mathematics and coding through interactive puzzle adventures.",
            industry: "Information"
        },
        {
            title: "Collab Editor",
            concept: "A real-time collaborative document editing and note-taking platform tailored for developer teams to write markdown and code together.",
            industry: "Information"
        },
        {
            title: "Pop-up Dining",
            concept: "A subscription club organizing exclusive pop-up dining events featuring local guest chefs in rotating secret locations.",
            industry: "Accommodation and Food Services"
        },
        {
            title: "Digital Wallet",
            concept: "A digital wallet and invoice management app designed for freelancers to track client payments, send invoices, and convert currencies instantly.",
            industry: "Finance and Insurance"
        },
        {
            title: "Gig Courier",
            concept: "An on-demand local courier service employing gig workers to deliver packages and documents across metro areas within 30 minutes.",
            industry: "Accommodation and Food Services"
        },
        {
            title: "Virtual Classroom",
            concept: "An interactive virtual classroom tool for schools featuring built-in quiz builders, breakout rooms, and offline learning fallbacks.",
            industry: "Information"
        }
    ];

    const [placeholderText, setPlaceholderText] = useState('Describe your idea in detail...');
    const ideas = [
        "A hyper-local B2B marketplace connecting farmers directly with retail grocery stores...",
        "An autonomous logistics optimization routing engine for micro-fulfillment centers...",
        "A RAG-powered cybersecurity advisor that audits smart contracts for vulnerabilities...",
        "An AI co-founder that validates startup concepts using multi-agent RAG engines..."
    ];

    const recommendedIndustries = useMemo(() => {
        if (!idea.trim()) return [];
        const text = idea.toLowerCase();
        
        const INDUSTRY_KEYWORDS: { [key: string]: string[] } = {
            "Food Services": ["food", "meal", "restaurant", "recipe", "chef", "dining", "cafe", "cooking", "beverage", "drink", "kitchen", "organic", "grocery", "barista", "espresso", "coffee", "delivery", "subscription box", "kits", "culinary", "catering", "eats", "foodtech"],
            "Health Care": ["health", "medical", "doctor", "clinic", "hospital", "patient", "biotech", "care", "medicine", "wellness", "clinical", "fitness", "therapy", "disease", "pharma", "treatment", "telehealth", "medtech", "healthtech"],
            "Finance and Insurance": ["finance", "insurance", "bank", "payment", "money", "loan", "investment", "credit", "fintech", "wallet", "crypto", "trading", "stock", "wealth", "insurtech", "lend", "defi", "wealthtech", "blockchain"],
            "Retail Trade": ["retail", "shop", "e-commerce", "store", "commerce", "buy", "sell", "clothing", "goods", "apparel", "customer", "marketplace", "checkout", "fashion", "brand", "d2c", "b2c", "sales"],
            "Manufactures": ["manufactur", "factory", "production", "industrial", "hardware", "material", "assembly", "parts", "print 3d", "machine", "builder", "device", "robotics", "iot", "3d printing", "automotive"],
            "Information Sector": ["software", "ai", "artificial intelligence", "data", "cloud", "saas", "app", "web", "cybersecurity", "security", "developer", "api", "network", "platform", "algorithm", "analytics", "coding", "game", "mobile", "education", "educational", "teach", "learn", "school", "student", "classroom", "course", "e-learning", "edtech", "gamified", "interactive", "programming", "computer", "technology", "puzzle", "suite", "digital"]
        };

        const scores = Object.entries(INDUSTRY_KEYWORDS).map(([ind, keywords]) => {
            let score = 0;
            keywords.forEach(kw => {
                if (text.includes(kw)) {
                    score += 1;
                }
            });
            return { ind, score };
        });

        return scores
            .filter(item => item.score > 0)
            .sort((a, b) => b.score - a.score)
            .map(item => item.ind)
            .slice(0, 3);
    }, [idea]);

    useEffect(() => {
        if (idea) return;
        let ideaIndex = 0;
        let charIndex = 0;
        let isDeleting = false;
        let typingSpeed = 60;
        let timer: any;

        const handleType = () => {
            const currentIdea = ideas[ideaIndex];
            if (!isDeleting) {
                setPlaceholderText(currentIdea.substring(0, charIndex + 1));
                charIndex++;
                if (charIndex === currentIdea.length) {
                    isDeleting = true;
                    typingSpeed = 2000;
                } else {
                    typingSpeed = 60;
                }
            } else {
                setPlaceholderText(currentIdea.substring(0, charIndex - 1));
                charIndex--;
                if (charIndex === 0) {
                    isDeleting = false;
                    ideaIndex = (ideaIndex + 1) % ideas.length;
                    typingSpeed = 500;
                } else {
                    typingSpeed = 30;
                }
            }
            timer = setTimeout(handleType, typingSpeed);
        };

        timer = setTimeout(handleType, 1000);
        return () => clearTimeout(timer);
    }, [idea]);


    useEffect(() => {
        const handleScroll = () => {
            const totalScroll = document.documentElement.scrollHeight - window.innerHeight;
            if (totalScroll > 0) {
                setScrollProgress((window.scrollY / totalScroll) * 100);
            }
        };
        window.addEventListener('scroll', handleScroll);
        return () => window.removeEventListener('scroll', handleScroll);
    }, []);

    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        entry.target.classList.add('visible');
                    }
                });
            },
            { threshold: 0.05 }
        );

        const elements = document.querySelectorAll('.scroll-reveal');
        elements.forEach((el) => observer.observe(el));

        return () => {
            elements.forEach((el) => observer.unobserve(el));
        };
    }, [data, failedStartupsData, failedStartupsLoading]);

    const handleAnalyze = async (keyOverride?: string) => {
        if (!idea || !industry) return;
        setLoading(true);
        setError('');
        setIsQuotaError(false);
        setData(null);
        setFailedStartupsData(null);

        const now = new Date();
        const getTimestamp = (offsetSec = 0) => {
            const t = new Date(now.getTime() + offsetSec * 1000);
            return t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        };

        const simulatedSteps = [
            `🛰️ Initializing market research for "${idea}" in "${geographicMarket}"...`,
            `📡 Connecting to Google Gemini API Key Pool...`,
            `⚡ Primary key active. Establishing reasoning boundaries...`,
            `🔎 Querying Google Search grounding indexes for "${industry}" competitors in "${geographicMarket}"...`,
            `📦 Processing web crawler nodes and scraping top search results...`,
            `⛓️ Connecting to ChromaDB Failed Startups vector space...`,
            `🔍 Ingesting historical failure indicators for "${industry}" startups...`,
            `🧠 Launching autonomous Bull & Bear debate agents...`,
            `⚖️ Passing debate matrix to Judge Agent for verdict synthesis...`,
            `📈 Calculating viability index score (0-100)...`,
            `📊 Estimating TAM, SAM, and SOM size dynamics...`,
            `🧬 Running financial projection simulations (User growth, break-even)...`,
            `✨ Finalizing strategic roadmap and SWOT vectors...`,
            `📝 Structuring premium market intelligence memo JSON schema...`
        ];

        setLogs([`[${getTimestamp(0)}] 🚀 StartupLens agent system initiated.`]);

        let stepIdx = 0;
        const intervalId = setInterval(() => {
            if (stepIdx < simulatedSteps.length) {
                setLogs(prev => [...prev, `[${getTimestamp(stepIdx * 1.5)}] ${simulatedSteps[stepIdx]}`]);
                stepIdx++;
            } else {
                const extraIndex = stepIdx - simulatedSteps.length;
                const extraLogs = [
                    `⏳ Analyzing competitor density and market saturations...`,
                    `Refining neural weights on RAG search results...`,
                    `Verification pipeline evaluating break-even matrix...`,
                    `Parsing complex JSON memo outputs...`
                ];
                if (extraIndex < extraLogs.length) {
                    setLogs(prev => [...prev, `[${getTimestamp(stepIdx * 1.5)}] ${extraLogs[extraIndex]}`]);
                    stepIdx++;
                }
            }
        }, 1100);

        const activeKey = keyOverride || customKey;

        try {
            const bodyPayload: any = { idea, industry, geographic_market: geographicMarket };
            if (activeKey) {
                bodyPayload.custom_api_key = activeKey;
            }

            setFailedStartupsLoading(true);

            // Execute BOTH API calls concurrently to reduce loading latency by 50%
            const analyzePromise = fetch(`${API_BASE_URL}/analyze`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(bodyPayload)
            });

            const fsBodyPayload: any = { query: `${industry} ${idea} in ${geographicMarket}` };
            if (activeKey) {
                fsBodyPayload.custom_api_key = activeKey;
            }
            const fsPromise = fetch(`${API_BASE_URL}/api/failed-startups`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(fsBodyPayload)
            });

            const [response, fsResponse] = await Promise.all([analyzePromise, fsPromise]);

            if (response.status === 429) {
                throw new Error("API_QUOTA_EXHAUSTED");
            }

            if (!response.ok) throw new Error('Analysis failed');
            const result = await response.json();
            console.log("Analysis Result:", result);
            setData(result);

            let fsData: any = null;
            try {
                if (fsResponse.ok) {
                    fsData = await fsResponse.json();
                } else {
                    throw new Error("Failed to fetch startups info");
                }
            } catch (err) {
                console.error("Failed to parse failed startups data:", err);
                fsData = { error: "Could not connect to the RAG backend server. Please verify python -m src.server is running." };
            }
            
            setFailedStartupsData(fsData);
            setFailedStartupsLoading(false);
            
            clearInterval(intervalId);
            const allLogs = simulatedSteps.map((step, idx) => `[${getTimestamp(idx * 1.5)}] ${step}`);
            allLogs.push(`[${getTimestamp(simulatedSteps.length * 1.5 + 1.5)}] ✅ Intelligence compilation complete! Rendering dashboard views.`);
            setLogs(allLogs);

            setTimeout(() => {
                setShowCurrencyTip(true);
            }, 2000);

            // Auto-save to Supabase if signed in
            if (user) {
                await saveAnalysisToSupabase(idea, industry, geographicMarket, result, fsData);
            }

            if (keyOverride) {
                setCustomKey(keyOverride);
            }

        } catch (err: any) {
            clearInterval(intervalId);
            setLogs(prev => [...prev, `[${getTimestamp(stepIdx * 1.5)}] ❌ Analysis system encountered an error: ${err.message || err}`]);
            console.error(err);
            if (err.message === "API_QUOTA_EXHAUSTED") {
                setIsQuotaError(true);
                setError('Daily API Quota Exceeded');
            } else {
                setError('Failed to connect to the analysis engine. Please try again.');
            }
        } finally {
            setTimeout(() => {
                setLoading(false);
            }, 800);
        }
    };

    const handlePrint = () => {
        window.print();
    };

    let marketShareData = (data?.research?.competitors || []).map((c: any) => ({
        name: c.name,
        value: typeof c.market_share === 'string' ? parseFloat(c.market_share.replace(/[^0-9.]/g, '')) || 0 : Number(c.market_share || 0)
    })).filter((item: any) => !isNaN(item.value) && item.value > 0);

    if (marketShareData.length === 0 && data?.research?.competitors?.length > 0) {
        const fallbackShare = Math.floor(100 / data.research.competitors.length);
        marketShareData = data.research.competitors.map((c: any) => ({
            name: c.name || 'Unknown',
            value: fallbackShare
        }));
    }

    let demographicsData = data?.strategy?.demographics?.age_groups ?
        Object.entries(data.strategy.demographics.age_groups).map(([key, value]: [string, any]) => ({
            name: key,
            percentage: typeof value === 'string' ? parseFloat(value.replace(/[^0-9.]/g, '')) || 0 : Number(value || 0)
        })).filter((item: any) => !isNaN(item.percentage) && item.percentage > 0) : [];

    if (demographicsData.length === 0 && data?.strategy?.demographics?.age_groups) {
        demographicsData = [
            { name: '18-24', percentage: 20 },
            { name: '25-34', percentage: 40 },
            { name: '35-44', percentage: 25 },
            { name: '45+', percentage: 15 }
        ];
    }

    return (
        <div className={`min-h-screen ${colors.bg} ${colors.text} font-sans selection:bg-blue-500/30 print:bg-white flex relative w-full`}>
            <style>
                {`
          .scroll-reveal {
            opacity: 1;
            transform: none;
            transition: opacity 0.8s cubic-bezier(0.22, 1, 0.36, 1), transform 0.8s cubic-bezier(0.22, 1, 0.36, 1);
          }
          .scroll-reveal.visible {
            opacity: 1;
            transform: none;
          }

          .hash-loader {
            position: relative;
            width: 50px;
            height: 50px;
            transform: rotate(165deg);
          }
          .hash-loader:before,
          .hash-loader:after {
            content: '';
            position: absolute;
            top: 50%;
            left: 50%;
            display: block;
            width: 10px;
            height: 10px;
            border-radius: 5px;
            transform: translate(-50%, -50%);
            transition: all 0.3s;
          }
          .hash-loader:before {
            animation: hash-before 2s infinite ease-in-out;
          }
          .hash-loader:after {
            animation: hash-after 2s infinite ease-in-out;
          }
          @keyframes hash-before {
            0% {
              width: 10px;
              box-shadow: 15px -15px 0 #111827, -15px 15px 0 #111827;
            }
            35% {
              width: 65px;
              box-shadow: 0 -15px 0 #111827, 0 15px 0 #111827;
            }
            70% {
              width: 10px;
              box-shadow: -15px -15px 0 #111827, 15px 15px 0 #111827;
            }
            100% {
              box-shadow: 15px -15px 0 #111827, -15px 15px 0 #111827;
            }
          }
          @keyframes hash-after {
            0% {
              height: 10px;
              box-shadow: -15px -15px 0 #111827, 15px 15px 0 #111827;
            }
            35% {
              height: 65px;
              box-shadow: -15px 0 0 #111827, 15px 0 0 #111827;
            }
            70% {
              height: 10px;
              box-shadow: -15px 15px 0 #111827, 15px -15px 0 #111827;
            }
            100% {
              box-shadow: -15px -15px 0 #111827, 15px 15px 0 #111827;
            }
          }

          .no-scrollbar::-webkit-scrollbar {
            display: none;
          }
          .no-scrollbar {
            -ms-overflow-style: none;
            scrollbar-width: none;
          }

          @media print {
            .no-print { display: none !important; }
            body { background-color: white !important; color: #0f172a !important; -webkit-print-color-adjust: exact; }
            .print-card { 
               background-color: white !important; 
               border: 1px solid #cbd5e1 !important; 
               box-shadow: none !important; 
               color: #0f172a !important; 
               break-inside: avoid;
               padding: 1.5rem !important;
               min-height: auto !important;
            }
            /* Universal text colors for high-contrast print readability */
            .text-white, .text-slate-100, .text-slate-200, .text-slate-300 { color: #0f172a !important; }
            .text-slate-400, .text-slate-500 { color: #475569 !important; }
            .text-blue-300, .text-blue-400, .text-blue-500 { color: #1e40af !important; }
            .text-emerald-400, .text-emerald-500 { color: #064e3b !important; }
            .text-amber-400, .text-amber-500 { color: #92400e !important; }
            .text-purple-400, .text-purple-500 { color: #6b21a8 !important; }
            .text-red-400, .text-red-500 { color: #991b1b !important; }
            .text-rose-400, .text-rose-500 { color: #be123c !important; }

            /* Remove dark backgrounds and transparency */
            .bg-slate-900, .bg-slate-950, .bg-slate-900\/50, .bg-slate-900\/40, .bg-slate-900\/60, .bg-slate-950\/50, .bg-slate-900\/10 { 
                background-color: transparent !important; 
            }
            .backdrop-blur-sm, .backdrop-blur-md { backdrop-filter: none !important; }
            
            /* Give failed startups boxes and insights a subtle background for contrast */
            .bg-blue-900\/10, .bg-slate-950\/50, .bg-red-500\/10 { 
                background-color: #f8fafc !important; 
                border: 1px solid #e2e8f0 !important; 
            }
            
            /* Style black containers (like Contrarian Take box) nicely for print to save ink and ensure text is readable */
            .bg-black {
                background-color: #f8fafc !important;
                border: 1px solid #cbd5e1 !important;
                color: #0f172a !important;
            }
            .border-black {
                border-color: #cbd5e1 !important;
            }
            .border-rose-500\/30 {
                border-color: #f43f5e !important;
            }
            .border-emerald-500\/30 {
                border-color: #10b981 !important;
            }
            
            /* Ensure bars and indicators remain visible */
            .bg-blue-600, .bg-blue-500 { background-color: #2563eb !important; }
          }
        `}
            </style>

            {/* Collapsible Sidebar (Authenticated users only) */}
            {user && !isSidebarCollapsed && (() => {

                return (
                    <aside className="bg-[#F9FAFB] border-r border-[#C0C0C0] flex flex-col h-screen sticky top-0 shrink-0 z-[60] print:hidden select-none w-[280px] overflow-hidden">
                        {/* Expanded State Layout */}
                        <div className="flex flex-col h-full w-full overflow-hidden animate-fade-in">
                                {/* Header with New Analysis button */}
                                <div className="p-4 border-b border-[#C0C0C0] space-y-3 shrink-0 bg-[#F9FAFB]">
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs font-mono uppercase tracking-widest text-[#4B5563] font-bold">Analyses History</span>
                                        <div className="flex items-center space-x-1.5">
                                            <button 
                                                onClick={handleNewAnalysis}
                                                className="p-1 border border-black/10 hover:border-black hover:bg-black/5 transition-all flex items-center justify-center rounded-none"
                                                title="New Analysis"
                                            >
                                                <Plus className="w-3.5 h-3.5" />
                                            </button>
                                            <button 
                                                onClick={() => setIsSidebarCollapsed(true)}
                                                className="w-8 h-8 bg-[#F3F4F6] hover:bg-[#E5E7EB] border border-[#D1D5DB] rounded-lg transition-all flex items-center justify-center focus:outline-none shadow-sm"
                                                title="Collapse Sidebar"
                                            >
                                                <ChevronLeft className="w-4 h-4 text-black stroke-[2]" />
                                            </button>
                                        </div>
                                    </div>
                                    <div className="relative">
                                        <input 
                                            type="text"
                                            placeholder="Search reports..."
                                            value={searchQuery}
                                            onChange={(e) => setSearchQuery(e.target.value)}
                                            className="w-full pl-8 pr-3 py-1.5 border border-[#C0C0C0] text-xs focus:outline-none focus:border-black rounded-none bg-white font-mono"
                                        />
                                        <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-black/35" />
                                    </div>
                                </div>

                                {/* History List */}
                                <div className="flex-1 overflow-y-auto divide-y divide-[#E5E7EB] no-scrollbar">
                                    {filteredHistory.length === 0 ? (
                                        <div className="p-8 text-center text-xs text-black/45 font-mono">
                                            No analyses found.
                                        </div>
                                    ) : (
                                        filteredHistory.map((item) => (
                                            <div 
                                                key={item.id}
                                                onClick={() => loadHistoryItem(item)}
                                                className="p-4 hover:bg-[#F3F4F6] cursor-pointer transition-all duration-150 flex items-start justify-between group"
                                            >
                                                <div className="flex flex-col min-w-0 pr-2">
                                                    <div className="flex items-center gap-1.5">
                                                        {item.pinned && <Pin className="w-3 h-3 text-[#111827] fill-[#111827]" />}
                                                        <span className="text-[11px] font-bold text-[#111827] font-sans truncate">{item.title}</span>
                                                    </div>
                                                    <span className="text-[10px] text-black/40 font-mono mt-1 truncate">{item.idea}</span>
                                                    <span className="text-[9px] text-[#4B5563] font-semibold uppercase tracking-wider mt-1">{item.geographic_market}</span>
                                                </div>

                                                <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                                    <button 
                                                        onClick={(e) => handleTogglePin(item.id, item.pinned, e)}
                                                        className="p-1 border border-black/10 hover:border-black hover:bg-white text-black/55 hover:text-black transition-colors"
                                                    >
                                                        <Pin className={`w-3 h-3 ${item.pinned ? 'fill-black' : ''}`} />
                                                    </button>
                                                    <button 
                                                        onClick={(e) => handleDeleteHistoryItem(item.id, e)}
                                                        className="p-1 border border-black/10 hover:border-red-600 hover:bg-white text-black/55 hover:text-red-600 transition-colors"
                                                    >
                                                        <Trash2 className="w-3 h-3" />
                                                    </button>
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>

                                {/* Account bottom bar */}
                                <div className="p-4 border-t border-[#C0C0C0] bg-[#F9FAFB] flex items-center justify-between shrink-0 font-mono text-[10px]">
                                    <div className="flex flex-col min-w-0">
                                        <span className="text-[9px] font-bold uppercase tracking-wider text-[#4B5563]">Account</span>
                                        <span className="text-black/60 truncate font-semibold w-[120px] block" title={user.email}>{user.email}</span>
                                    </div>
                                    <button 
                                        onClick={onLogout}
                                        className="p-1.5 border border-black/10 hover:border-black hover:bg-black/5 transition-all text-black/60 hover:text-black flex items-center gap-1 font-bold uppercase tracking-wider font-mono text-[9px]"
                                    >
                                        <LogOut className="w-3 h-3" />
                                        Log out
                                    </button>
                                </div>
                            </div>
                    </aside>
                );
            })()}

            {/* Main view container */}
            <div className="flex-grow min-w-0 min-h-screen relative flex flex-col">
                <div className="no-print absolute inset-0 w-full h-full overflow-hidden pointer-events-none z-0">
                    <InteractiveCanvas className="fixed inset-0 w-full h-full pointer-events-none z-0" isFlat={true} />
                </div>

            {/* Scroll Progress Bar */}
            {data && (
                <div className={`no-print fixed top-[75px] h-[3px] bg-black/5 z-[50] transition-all duration-300 ${
                    user && !isSidebarCollapsed ? 'left-[280px] w-[calc(100%-280px)]' : 'left-0 w-full'
                }`}>
                    <div 
                        className="h-full bg-[#111827] transition-all duration-75"
                        style={{ width: `${scrollProgress}%` }}
                    ></div>
                </div>
            )}

            {isGuest && (
                <div className="no-print bg-[#FFFBEB] border-b border-[#F59E0B]/25 p-3 flex items-center justify-between px-6 text-xs text-[#92400E] z-40 relative">
                    <div className="flex items-center gap-2 font-medium">
                        <Unlock className="w-4 h-4 text-[#D97706]" />
                        <span>You are analyzing as a <strong>Guest</strong>. Sign in to save your reports, see historical analysis, search, and pin results.</span>
                    </div>
                    <button 
                        onClick={onLogout}
                        className="px-2.5 py-1 bg-[#D97706] hover:bg-[#B45309] text-white text-[10px] font-bold uppercase tracking-wider transition-colors font-mono rounded-none"
                    >
                        Sign In Now
                    </button>
                </div>
            )}

            <nav className={`sticky top-0 border-b border-[#C0C0C0] h-[75px] flex items-center shadow-sm print:hidden transition-all duration-300 ${
                showCurrencyTip ? 'z-[10000] bg-white' : 'z-50 bg-white/95'
            }`}>
                <div className="max-w-[1440px] mx-auto px-6 md:px-10 flex items-center justify-between w-full">
                    <div className="flex items-center space-x-3">
                        {user && isSidebarCollapsed && (
                            <button
                                onClick={() => setIsSidebarCollapsed(false)}
                                className="w-8 h-8 bg-[#F3F4F6] hover:bg-[#E5E7EB] border border-[#D1D5DB] rounded-lg transition-all flex items-center justify-center shrink-0 focus:outline-none shadow-sm mr-2"
                                title="Open Sidebar"
                            >
                                <Menu className="w-4 h-4 text-black stroke-[2]" />
                            </button>
                        )}
                        <div
                            className="flex items-center space-x-3 cursor-pointer group"
                            onClick={() => onBack()}
                        >
                            <img src="/logo.svg" alt="StartupLens Logo" className="w-8 h-8 object-contain" style={{ filter: 'brightness(0)' }} />
                            <span className="text-2xl font-medium tracking-tight text-[#111827] font-sans">StartupLens</span>
                        </div>
                    </div>
                    <div className="flex items-center space-x-6">
                        {data && !loading && (
                            <div className={`flex items-center space-x-1.5 p-1 rounded-none border no-print transition-all duration-300 relative ${
                                showCurrencyTip 
                                    ? 'z-[10000] bg-white border-black ring-4 ring-white shadow-2xl scale-105' 
                                    : 'bg-black/5 border-black/10'
                            }`}>
                                <span className="text-[10px] text-black/50 font-bold uppercase tracking-wider px-2 font-mono">Currency:</span>
                                <button
                                    onClick={() => setCurrency('USD')}
                                    className={`px-2 py-1 text-[10px] font-bold font-mono transition-all duration-200 ${currency === 'USD' ? 'bg-[#111827] text-white' : 'text-black/60 hover:text-black'}`}
                                >
                                    USD ($)
                                </button>
                                <button
                                    onClick={() => setCurrency('INR')}
                                    className={`px-2 py-1 text-[10px] font-bold font-mono transition-all duration-200 ${currency === 'INR' ? 'bg-[#111827] text-white' : 'text-black/60 hover:text-black'}`}
                                >
                                    INR (₹)
                                </button>
                                <button
                                    onClick={() => setCurrency('EUR')}
                                    className={`px-2 py-1 text-[10px] font-bold font-mono transition-all duration-200 ${currency === 'EUR' ? 'bg-[#111827] text-white' : 'text-black/60 hover:text-black'}`}
                                >
                                    EUR (€)
                                </button>
                                <button
                                    onClick={() => setCurrency('GBP')}
                                    className={`px-2 py-1 text-[10px] font-bold font-mono transition-all duration-200 ${currency === 'GBP' ? 'bg-[#111827] text-white' : 'text-black/60 hover:text-black'}`}
                                >
                                    GBP (£)
                                </button>
                                
                                {/* Tour Tooltip */}
                                {showCurrencyTip && (
                                    <div className="absolute top-full left-1/2 -translate-x-1/2 mt-4 bg-white text-black p-6 border-2 border-black w-80 shadow-2xl rounded-none flex flex-col space-y-2 z-[10001] pointer-events-auto cursor-default normal-case tracking-normal text-left font-sans select-none animate-fade-in">
                                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-[10px] border-l-transparent border-r-[10px] border-r-transparent border-b-[10px] border-b-black"></div>
                                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-[9px] border-l-transparent border-r-[9px] border-r-transparent border-b-[9px] border-b-white z-10"></div>
                                        <h4 className="text-sm font-bold uppercase font-mono tracking-wider flex items-center text-black">
                                            <Zap className="w-4 h-4 mr-1.5 text-amber-500" /> Dynamic Currency
                                        </h4>
                                        <p className="text-xs text-black/80 leading-relaxed font-sans font-medium">
                                            You can dynamically change all monetary values on this report (cash burned, revenue, investment) to your preferred local currency here!
                                        </p>
                                        <span className="text-[10px] font-mono text-black/40 pt-2 uppercase">Click anywhere to dismiss</span>
                                    </div>
                                )}
                            </div>
                        )}
                        <button
                            onClick={() => onBack()}
                            className="flex items-center space-x-2 text-sm font-medium text-[#4B5563] hover:text-[#111827] transition-colors"
                        >
                            <Home className="w-4 h-4" />
                            <span>Back to Home</span>
                        </button>
                                    {user && (
                            <div className="relative relative-dropdown border-l border-black/10 pl-4 ml-2 flex items-center">
                                <button
                                    onClick={() => setShowProfileDropdown(!showProfileDropdown)}
                                    className="focus:outline-none flex items-center justify-center w-8 h-8 rounded-full border border-black/10 hover:border-black/30 hover:bg-black/5 transition-all text-[#4B5563]"
                                    title="Account settings"
                                >
                                    <User className="w-4.5 h-4.5" />
                                </button>

                                {showProfileDropdown && (
                                    <div className="absolute right-0 top-full mt-3.5 w-64 bg-white border border-[#E5E7EB] shadow-2xl rounded-lg py-4 px-5 z-[10002] animate-fade-in flex flex-col text-left">
                                        <div className="flex flex-col pb-3 border-b border-[#E5E7EB] min-w-0">
                                            <span className="font-sans font-bold text-sm text-[#111827] truncate">
                                                {user.email.split('@')[0].split(/[._-]/).map((word: string) => word.charAt(0).toUpperCase() + word.slice(1)).join('')}
                                            </span>
                                            <span className="font-sans text-xs text-gray-500 truncate mt-0.5 select-all">
                                                {user.email}
                                            </span>
                                        </div>
                                        <div className="flex flex-col pt-3 space-y-2.5 font-mono text-xs">
                                            <button 
                                                onClick={() => {
                                                    setShowProfileDropdown(false);
                                                    onLogout();
                                                }}
                                                className="w-full text-left py-1 text-red-600 hover:text-red-700 flex items-center gap-2 transition-colors font-bold uppercase text-[10px] tracking-wider"
                                            >
                                                <LogOut className="w-3.5 h-3.5" />
                                                Log Out
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </nav>

            <div className="max-w-[1440px] mx-auto p-4 md:pt-[30px] md:pb-[60px] md:px-10 space-y-[32px] relative z-10">

                {!data && !loading && !error && (
                    <div className="w-full mt-2 space-y-6 animate-fade-in-up">
                        <div className="text-center space-y-2">
                            <h2 className="text-4xl md:text-5xl font-semibold text-[#111827] tracking-tight">
                                Validate Your <span className="text-[#111827] underline decoration-2 underline-offset-4 font-bold">Vision.</span>
                            </h2>
                            <p className="text-[#4B5563] text-lg leading-relaxed max-w-xl mx-auto">
                                Enter your startup concept below to generate a professional market analysis, competitor breakdown, and strategic roadmap.
                            </p>
                        </div>

                        {/* Preset Prompts Panel */}
                        <div className="flex flex-row gap-2 pb-1 no-print flex-wrap justify-center">
                            {PRESETS.slice(0, 4).map((preset, idx) => (
                                <button
                                    key={idx}
                                    onClick={() => {
                                        setIdea(preset.concept);
                                        setIndustry(preset.industry);
                                    }}
                                    className="px-3 py-1.5 bg-white border border-[#C0C0C0] hover:border-[#111827] text-[#4B5563] hover:text-[#111827] text-xs font-medium transition-colors duration-150 rounded-none"
                                    title={`${preset.concept} (${preset.industry})`}
                                >
                                    {preset.title}
                                </button>
                            ))}
                        </div>

                        <div className={`p-8 ${colors.card} space-y-6 relative overflow-hidden`}>
                            <div className="space-y-6 relative z-10">
                                <div className="flex flex-col space-y-2">
                                    <label className="text-xs font-bold text-black uppercase tracking-widest">Startup Concept</label>
                                    <textarea
                                        className="bain-input h-32 resize-none"
                                        placeholder={placeholderText}
                                        value={idea}
                                        onChange={(e) => setIdea(e.target.value)}
                                    />
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="flex flex-col space-y-2">
                                        <label className="text-xs font-bold text-black uppercase tracking-widest">Target Industry</label>
                                        <input
                                            type="text"
                                            className="bain-input"
                                            placeholder={recommendedIndustries.length > 0 ? `e.g., ${recommendedIndustries.join(', ')}` : "e.g., EdTech, Fintech, Agritech"}
                                            value={industry}
                                            onChange={(e) => setIndustry(e.target.value)}
                                        />
                                    </div>
                                    <div className="flex flex-col space-y-2">
                                        <label className="text-xs font-bold text-black uppercase tracking-widest">Geographic Market</label>
                                        <select
                                            value={geographicMarket}
                                            onChange={(e) => setGeographicMarket(e.target.value as any)}
                                            className="bain-input bg-white cursor-pointer px-4 py-3 border border-[#C0C0C0] rounded-lg text-sm text-[#111827] focus:border-[#111827] focus:ring-1 focus:ring-[#111827] outline-none"
                                        >
                                            <option value="Global">Global</option>
                                            <option value="India">India</option>
                                            <option value="USA">USA</option>
                                            <option value="Europe">Europe</option>
                                        </select>
                                    </div>
                                </div>
                                <button
                                    onClick={() => handleAnalyze()}
                                    disabled={!idea || !industry}
                                    className={`w-full ${colors.buttonPrimary} disabled:opacity-50 disabled:cursor-not-allowed`}
                                >
                                    <span>Generate Intelligence Report</span>
                                    <ArrowRight className="w-5 h-5 ml-2" />
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {loading && (
                    <div className="max-w-4xl mx-auto flex flex-col items-center justify-center min-h-[500px] space-y-8 py-12 px-4">
                        <div className="flex flex-col items-center justify-center space-y-4">
                            <div className="flex items-center justify-center p-6">
                                <div className="hash-loader"></div>
                            </div>
                            <div className="text-center space-y-2">
                                <h3 className="text-3xl font-bold text-[#111827] tracking-tight">Generating Intelligence...</h3>
                                <p className="text-[#4B5563] text-lg font-light">Analyzing competitors, risks, and market gaps.</p>
                            </div>
                        </div>

                        {/* Real-time proactive log monitor */}
                        <div className="w-full bg-[#0f0e0d] text-[#e6dfd9] border border-[#26211e] shadow-2xl p-6 font-mono text-sm leading-relaxed overflow-hidden flex flex-col h-[280px] rounded-none">
                            <div className="flex items-center justify-between border-b border-[#26211e] pb-3 mb-3 text-xs text-[#8e857b] tracking-wider select-none">
                                <div className="flex items-center space-x-2">
                                    <span className="w-2 h-2 bg-[#d67b5c] rounded-full animate-ping"></span>
                                    <span className="font-bold text-[#d67b5c]">&gt;_ REAL-TIME PROACTIVE LOG MONITOR</span>
                                </div>
                                <div className="flex items-center space-x-4">
                                    <span>STATUS: <span className="text-[#d67b5c] font-bold animate-pulse">ACTIVE</span></span>
                                    <span className="text-[#3c3530]">|</span>
                                    <span>STREAMING</span>
                                </div>
                            </div>
                            <div className="flex-1 overflow-y-auto space-y-2 pr-2 scrollbar-thin scrollbar-thumb-zinc-700 scrollbar-track-transparent text-left" id="terminal-logs-container">
                                {logs.map((log, index) => {
                                    const match = log.match(/^\[(.*?)\] (.*)$/);
                                    if (match) {
                                        const [, time, msg] = match;
                                        return (
                                            <div key={index} className="flex items-start space-x-2 text-[#ccc] hover:text-white transition-colors duration-150">
                                                <span className="text-[#d67b5c] select-none font-semibold flex-shrink-0">[{time}]</span>
                                                <span className="font-light">{msg}</span>
                                            </div>
                                        );
                                    }
                                    return <div key={index} className="text-[#ccc] font-light">{log}</div>;
                                })}
                            </div>
                        </div>
                    </div>
                )}

                {error && (
                    <div className="max-w-2xl mx-auto mt-20 animate-fade-in text-center">
                        <div className={`p-8 ${colors.card} border ${colors.border} shadow-lg relative overflow-hidden`}>
                            {isQuotaError ? (
                                <div className="space-y-6">
                                    <div className="flex justify-center mb-2">
                                        <div className="p-4 bg-red-100 rounded-none animate-pulse">
                                            <Lock className="w-8 h-8 text-red-600" />
                                        </div>
                                    </div>
                                    <div>
                                        <h2 className="text-2xl font-bold text-primary mb-2">API Limit Reached</h2>
                                        <p className="text-mutedtext mb-6 leading-relaxed max-w-lg mx-auto">
                                            The demo server's daily rate limit has been exhausted. You can try again later, or use your own Google Gemini API key to continue testing immediately.
                                        </p>
                                    </div>

                                    <div className="max-w-md mx-auto bg-pagebg p-6 border border-bordercolor text-left space-y-4">
                                        <div className="flex flex-col space-y-2">
                                            <label className="text-xs font-bold text-primary uppercase tracking-wider">Enter Your Gemini API Key</label>
                                            <input
                                                type="password"
                                                className="bain-input w-full"
                                                placeholder="AIzaSy..."
                                                value={customKey}
                                                onChange={(e) => setCustomKey(e.target.value)}
                                            />
                                        </div>
                                        <button
                                            onClick={() => handleAnalyze(customKey)}
                                            disabled={!customKey}
                                            className="w-full py-3 bg-[#111827] hover:bg-[#4B5563] text-white rounded-none border border-[#111827] font-bold transition-all shadow-md flex items-center justify-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            <RefreshCw className="w-4 h-4" />
                                            <span>Retry with My Key</span>
                                        </button>
                                        <p className="text-[11px] text-[#4B5563] text-center">
                                            Your key is only used for this session and isn't stored.
                                        </p>
                                    </div>

                                    <button
                                        onClick={() => { setError(''); setIsQuotaError(false); }}
                                        className="text-[#111827] hover:underline text-sm font-medium transition-all"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            ) : (
                                <>
                                    <div className="flex justify-center mb-6">
                                        <AlertTriangle className="w-12 h-12 text-amber-500" />
                                    </div>
                                    <h2 className="text-2xl font-bold text-[#111827] mb-2">Analysis Failed</h2>
                                    <p className="text-[#4B5563] mb-6">{error}</p>
                                    <button
                                        onClick={() => setError('')}
                                        className="px-6 py-2 bg-[#111827] hover:bg-[#4B5563] text-white rounded-none transition-all font-medium border border-[#111827]"
                                    >
                                        Dismiss
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                )}

                {data && !loading && (
                    <div className="space-y-8 animate-fade-in pb-20 relative z-10">

                        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 scroll-reveal">
                            <div className={`col-span-1 ${colors.card} min-h-[190px] flex flex-col justify-between relative overflow-hidden shadow-none print-card`}>
                                <div className="flex items-center space-x-3 mb-2">
                                    <h3 className="text-lg font-bold text-[#111827] flex-1">Viability Score</h3>
                                    <button 
                                        onClick={() => setShowMethodology(true)}
                                        className="p-1 hover:bg-black/5 rounded-none text-black/40 hover:text-accent transition-colors no-print"
                                        title="View Calculation Methodology"
                                    >
                                        <Info className="w-4 h-4" />
                                    </button>
                                </div>
                                <div className="relative flex-1 flex items-center justify-center py-2">
                                    <svg className="w-32 h-32 transform -rotate-90">
                                        <circle cx="64" cy="64" r="54" stroke="currentColor" strokeWidth="8" fill="transparent" className="text-black/10" />
                                        <circle
                                            cx="64" cy="64" r="54"
                                            stroke="currentColor" strokeWidth="8"
                                            fill="transparent"
                                            strokeDasharray={339}
                                            strokeDashoffset={339 - (339 * (data.strategy?.viability_score || 0)) / 100}
                                            className="text-[#111827] transition-all duration-200 ease-in-out"
                                        />
                                    </svg>
                                    <div className="absolute inset-0 flex items-center justify-center flex-col">
                                        <span className="text-3xl font-bold text-[#111827] font-mono">{data.strategy?.viability_score || 0}</span>
                                    </div>
                                </div>
                            </div>

                            <div className={`col-span-1 md:col-span-3 ${colors.card} min-h-[190px] flex flex-col justify-center shadow-none print-card`}>
                                 <div className="flex items-center justify-between mb-2 w-full">
                                     <div className="flex items-center space-x-3">
                                         <div className="p-2 bg-black/5 border border-black/10 rounded-none no-print">
                                             <Zap className="w-5 h-5 text-[#111827]" />
                                         </div>
                                         <h3 className="text-lg font-bold text-[#111827]">The Whitespace Opportunity</h3>
                                     </div>
                                     <div className="relative group no-print">
                                         <button 
                                             className="p-1 hover:bg-black/5 rounded-none text-black/40 hover:text-black transition-colors"
                                             title="Section Info"
                                         >
                                             <Info className="w-4 h-4" />
                                         </button>
                                         
                                         {/* Hover Tooltip */}
                                         <div className="absolute top-full right-0 mt-2 hidden group-hover:block w-72 p-3 bg-white text-[#111827] text-xs leading-relaxed rounded-none shadow-lg border border-[#C0C0C0] z-[9999] pointer-events-none normal-case tracking-normal text-left font-sans select-none animate-fade-in">
                                             <div className="absolute bottom-full right-2 w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-b-[6px] border-b-[#C0C0C0]"></div>
                                             Highlights the clear entry gaps or pivot angles identified from looking at competitor post-mortems and market overlaps.
                                         </div>
                                     </div>
                                 </div>
                                <p className="text-black/80 text-sm leading-relaxed">
                                    {data.research?.opportunity || "Analysis pending..."}
                                </p>
                            </div>
                        </div>
                        
                        {/* Market Opportunity (TAM, SAM, SOM) */}
                        <div className={`scroll-reveal ${colors.card} p-6 shadow-sm print-card`}>
                            {/* Header */}
                            <div className="flex items-start justify-between mb-5">
                                <div>
                                    <h3 className="text-lg font-bold text-[#111827] flex items-center gap-2">
                                        Market Opportunity
                                    </h3>
                                    <span className="inline-flex items-center gap-1.5 mt-2 px-2.5 py-1 bg-[#F0F0F0] border border-[#C0C0C0] text-xs font-semibold text-[#4B5563] rounded-none">
                                        📍 Geography: {geographicMarket}
                                    </span>
                                </div>
                                {data.research?.market_sizing?.confidence && (
                                    <div className="flex flex-col items-end">
                                        <span className="text-[10px] font-bold uppercase tracking-widest text-black/40 mb-1">Confidence</span>
                                        <span className="text-2xl font-extrabold text-[#111827]">{data.research.market_sizing.confidence}%</span>
                                    </div>
                                )}
                            </div>

                            {data.research?.market_sizing?.tam ? (
                                <>
                                    {/* TAM / SAM / SOM rows */}
                                    <div className="space-y-3 mb-5">
                                        {[
                                            { label: 'TAM', sublabel: 'Total Addressable Market', value: data.research.market_sizing.tam, desc: 'The full market size if everyone adopted this solution' },
                                            { label: 'SAM', sublabel: 'Serviceable Addressable Market', value: data.research.market_sizing.sam, desc: 'The segment you can realistically reach with your model' },
                                            { label: 'SOM', sublabel: 'Serviceable Obtainable Market', value: data.research.market_sizing.som, desc: 'Your realistic capture over the next 3–5 years' },
                                        ].map(({ label, sublabel, value, desc }) => (
                                            <div key={label} className="flex items-center justify-between p-4 bg-white border border-[#E5E7EB] rounded-none group">
                                                <div className="flex flex-col">
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-xs font-extrabold text-[#111827] font-mono w-8">{label}</span>
                                                        <span className="text-[10px] text-[#374151] font-semibold uppercase tracking-wide">{sublabel}</span>
                                                    </div>
                                                    <span className="text-[10px] text-[#4B5563] mt-0.5 pl-10">{desc}</span>
                                                </div>
                                                <span className="text-xl font-extrabold text-[#111827] tabular-nums">{formatCurrency(value, currency)}</span>
                                            </div>
                                        ))}
                                    </div>

                                    {/* Explanation */}
                                    {data.research.market_sizing.explanation && (
                                        <div className="p-3 bg-[#F9FAFB] border border-[#E5E7EB] rounded-none">
                                            <p className="text-[11px] text-black/60 leading-relaxed">{renderBoldText(data.research.market_sizing.explanation)}</p>
                                        </div>
                                    )}
                                </>
                            ) : (
                                <div className="flex flex-col items-center justify-center py-8 text-center space-y-2">
                                    <span className="text-3xl">📊</span>
                                    <p className="text-sm font-medium text-black/50">Market sizing data not available for this analysis.</p>
                                    <p className="text-xs text-black/35">Run a fresh analysis to get localized TAM, SAM & SOM figures.</p>
                                </div>
                            )}
                        </div>


                        {data.strategy?.financials && (
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 scroll-reveal">
                                <div className={`${colors.card} h-[220px] flex flex-col justify-between shadow-none print-card`}>
                                    <h4 className="text-xs font-bold text-black/50 uppercase">Revenue / User</h4>
                                    <div className="flex flex-col">
                                        <p className="text-3xl font-bold text-emerald-700">
                                            {data.strategy.financials.revenue_per_user 
                                                ? formatCurrency(data.strategy.financials.revenue_per_user.split('(')[0].trim(), currency)
                                                : 'N/A'}
                                        </p>
                                        {data.strategy.financials.revenue_per_user && data.strategy.financials.revenue_per_user.includes('(') && (
                                            <p className="text-[10px] text-black/40 font-bold uppercase tracking-brand mt-1">
                                                {data.strategy.financials.revenue_per_user.split('(')[1].replace(')', '')}
                                            </p>
                                        )}
                                    </div>
                                </div>
                                <div className={`${colors.card} h-[220px] flex flex-col justify-between shadow-none print-card`}>
                                    <h4 className="text-xs font-bold text-black/50 uppercase">Min Investment</h4>
                                    <div className="flex flex-col">
                                        <p className="text-3xl font-bold text-[#111827]">
                                            {data.strategy.financials.min_investment 
                                                ? formatCurrency(data.strategy.financials.min_investment.split('(')[0].trim(), currency)
                                                : 'N/A'}
                                        </p>
                                        {data.strategy.financials.min_investment && data.strategy.financials.min_investment.includes('(') && (
                                            <p className="text-[10px] text-black/40 font-bold uppercase tracking-brand mt-1">
                                                {data.strategy.financials.min_investment.split('(')[1].replace(')', '')}
                                            </p>
                                        )}
                                    </div>
                                </div>
                                <div className={`${colors.card} h-[220px] flex flex-col justify-between shadow-none print-card`}>
                                    <h4 className="text-xs font-bold text-black/50 uppercase">Break-even</h4>
                                    <div className="flex flex-col">
                                        <p className="text-3xl font-bold text-amber-700">
                                            {data.strategy.financials.break_even 
                                                ? data.strategy.financials.break_even.split('(')[0].trim()
                                                : 'N/A'}
                                        </p>
                                        {data.strategy.financials.break_even && data.strategy.financials.break_even.includes('(') && (
                                            <p className="text-[10px] text-black/40 font-bold uppercase tracking-brand mt-1">
                                                {data.strategy.financials.break_even.split('(')[1].replace(')', '')}
                                            </p>
                                        )}
                                    </div>
                                </div>
                                <div className={`${colors.card} h-[220px] flex flex-col justify-between shadow-none print-card`}>
                                    <h4 className="text-xs font-bold text-black/50 uppercase">Growth Rate</h4>
                                    <div className="flex flex-col">
                                        <p className="text-3xl font-bold text-purple-700">
                                            {data.strategy.financials.user_growth_rate 
                                                ? data.strategy.financials.user_growth_rate.split('(')[0].trim()
                                                : 'N/A'}
                                        </p>
                                        {data.strategy.financials.user_growth_rate && data.strategy.financials.user_growth_rate.includes('(') && (
                                            <p className="text-[10px] text-black/40 font-bold uppercase tracking-brand mt-1">
                                                {data.strategy.financials.user_growth_rate.split('(')[1].replace(')', '')}
                                            </p>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}

                        <div className={`${colors.card} shadow-sm print-card scroll-reveal`}>
                            <div className="flex items-center justify-between mb-6 w-full">
                                <div className="flex items-center space-x-3">
                                    <TrendingUp className="w-5 h-5 text-[#111827] no-print" />
                                    <h2 className="text-xl font-bold text-[#111827]">Supporting Market Trends</h2>
                                </div>
                                <div className="relative group no-print">
                                    <button 
                                        className="p-1 hover:bg-black/5 rounded-none text-black/40 hover:text-black transition-colors"
                                        title="Section Info"
                                    >
                                        <Info className="w-4 h-4" />
                                    </button>
                                    <div className="absolute top-full right-0 mt-2 hidden group-hover:block w-72 p-3 bg-white text-[#111827] text-xs leading-relaxed rounded-none shadow-lg border border-[#C0C0C0] z-[9999] pointer-events-none normal-case tracking-normal text-left font-sans select-none animate-fade-in">
                                        <div className="absolute bottom-full right-2 w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-b-[6px] border-b-[#C0C0C0]"></div>
                                        Signals positive macro trends, technological shifts, or regulatory changes that validate the timing of your concept.
                                    </div>
                                </div>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {(data.research?.market_trends || []).map((trend: string, i: number) => (
                                    <div key={i} className="flex items-start space-x-3 p-4 rounded-none bg-white border border-black/10 text-black">
                                        <div className="mt-1"><ArrowRight className="w-4 h-4 text-[#111827]" /></div>
                                        <p className="text-black/80 text-sm leading-relaxed">{renderBoldText(trend)}</p>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 break-inside-avoid scroll-reveal">
                            <div className={`${colors.card} shadow-sm print-card`}>
                                <div className='flex justify-between items-center mb-4'>
                                    <h3 className="text-lg font-bold text-[#111827] flex items-center">
                                        <PieChartIcon className="w-5 h-5 mr-2 text-[#111827] no-print" /> Market Share
                                    </h3>
                                </div>
                                <div className="h-64 w-full">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <PieChart>
                                            <Pie
                                                data={marketShareData}
                                                innerRadius={60}
                                                outerRadius={80}
                                                paddingAngle={5}
                                                dataKey="value"
                                                stroke="none"
                                            >
                                                {marketShareData.map((_: any, index: number) => (
                                                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                                ))}
                                            </Pie>
                                            <Tooltip
                                                contentStyle={{ backgroundColor: '#000000', borderColor: '#FFFFFF', color: '#FFFFFF', borderRadius: '0px', boxShadow: 'none' }}
                                                itemStyle={{ color: '#FFFFFF' }}
                                            />
                                            <Legend verticalAlign="bottom" height={36} />
                                        </PieChart>
                                    </ResponsiveContainer>
                                </div>
                                <div className="mt-4 p-4 bg-black/5 rounded-none border border-black/10">
                                    <div className="flex items-start space-x-2">
                                        <div className="mt-1.5 w-2 h-2 rounded-full bg-[#111827] flex-shrink-0 animate-pulse no-print"></div>
                                        <p className="text-xs text-black/70 leading-relaxed font-medium">
                                            {data.research?.market_share_insight || "Competitors are fighting for dominance in this fragmented landscape."}
                                        </p>
                                    </div>
                                </div>
                            </div>

                            <div className={`${colors.card} shadow-sm print-card`}>
                                <div className='flex justify-between items-center mb-4'>
                                    <h3 className="text-lg font-bold text-[#111827] flex items-center">
                                        <Users className="w-5 h-5 mr-2 text-[#111827] no-print" /> Age Demographics
                                    </h3>
                                </div>
                                <div className="h-64 w-full">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={demographicsData}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#CCCCCC" vertical={false} />
                                            <XAxis
                                                dataKey="name"
                                                stroke="#000000"
                                                fontSize={12}
                                                tickLine={false}
                                                axisLine={false}
                                            />
                                            <YAxis
                                                stroke="#000000"
                                                fontSize={12}
                                                tickLine={false}
                                                axisLine={false}
                                                tickFormatter={(value) => `${value}%`}
                                            />
                                            <Tooltip
                                                cursor={{ fill: '#111827', opacity: 0.05 }}
                                                contentStyle={{ backgroundColor: '#FFFFFF', borderColor: '#C0C0C0', color: '#111827', borderRadius: '8px', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }}
                                            />
                                            <Bar dataKey="percentage" fill="#111827" radius={[8, 8, 0, 0]} barSize={40} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                                <div className="mt-4 p-4 bg-white rounded-lg border border-[#C0C0C0]">
                                    <div className="flex items-start space-x-2">
                                        <div className="mt-1.5 w-2 h-2 rounded-full bg-[#111827] flex-shrink-0 animate-pulse no-print"></div>
                                        <p className="text-xs text-[#4B5563] leading-relaxed font-medium">
                                            {data.strategy?.demographics?.demographics_insight || "Targeting the most active user base for maximum adoption."}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-6 scroll-reveal">
                            <div className="flex items-center space-x-3">
                                <Layers className="w-6 h-6 text-[#111827] no-print" />
                                <h2 className="text-2xl font-bold text-[#111827] font-medium">Execution Strategy</h2>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                <div className={`${colors.card} shadow-sm print-card`}>
                                    <div className="flex items-center space-x-3 mb-6">
                                        <TrendingUp className="w-5 h-5 text-[#111827] no-print" />
                                        <h3 className="text-lg font-bold text-black font-mono">Acquisition</h3>
                                    </div>
                                    <ul className="space-y-4">
                                        {(data.strategy?.user_acquisition || []).map((item: string, i: number) => {
                                            const parts = item.includes(':') ? item.split(':') : [item, ''];
                                            return (
                                                <li key={i}>
                                                    <span className="text-black font-semibold block mb-1">{renderBoldText(parts[0])}</span>
                                                    {parts[1] && <span className="text-black/60 text-xs leading-relaxed block">{renderBoldText(parts[1])}</span>}
                                                </li>
                                            );
                                        })}
                                    </ul>
                                </div>

                                <div className={`${colors.card} shadow-sm print-card`}>
                                    <div className="flex items-center space-x-3 mb-6">
                                        <DollarSign className="w-5 h-5 text-[#111827] no-print" />
                                        <h3 className="text-lg font-bold text-black font-mono">Monetization</h3>
                                    </div>
                                    <ul className="space-y-4">
                                        {(data.strategy?.business_models || []).map((item: string, i: number) => {
                                            const parts = item.includes(':') ? item.split(':') : [item, ''];
                                            return (
                                                <li key={i}>
                                                    <span className="text-black font-semibold block mb-1">{renderBoldText(parts[0])}</span>
                                                    {parts[1] && <span className="text-black/60 text-xs leading-relaxed block">{renderBoldText(parts[1])}</span>}
                                                </li>
                                            );
                                        })}
                                    </ul>
                                </div>

                                <div className={`${colors.card} shadow-sm print-card`}>
                                    <div className="flex items-center space-x-3 mb-6">
                                        <Shield className="w-5 h-5 text-red-500 no-print" />
                                        <h3 className="text-lg font-bold text-black font-mono">Primary Risk</h3>
                                    </div>
                                    <div className="p-4 bg-red-50 border border-red-200/50 rounded-none print:bg-red-50 print:border-red-200">
                                        <p className="text-red-600 text-sm leading-relaxed font-medium">{renderBoldText(data.strategy?.risk_analysis)}</p>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-6">
                            <div className="flex items-center space-x-3">
                                <BarChart3 className="w-6 h-6 text-[#111827] no-print" />
                                <h2 className="text-2xl font-bold text-[#111827] font-medium">SWOT Analysis</h2>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className={`${colors.card} shadow-sm print-card`}>
                                    <h4 className="text-emerald-700 font-bold mb-4 flex items-center"><CheckCircle className="w-4 h-4 mr-2" /> Strengths</h4>
                                    <ul className="list-disc list-inside space-y-2 text-black/80 text-xs">
                                        {(data.strategy?.swot?.strengths || []).map((item: string, i: number) => <li key={i}>{item}</li>)}
                                    </ul>
                                </div>
                                <div className={`${colors.card} shadow-sm print-card`}>
                                    <h4 className="text-red-600 font-bold mb-4 flex items-center"><AlertTriangle className="w-4 h-4 mr-2" /> Weaknesses</h4>
                                    <ul className="list-disc list-inside space-y-2 text-black/80 text-xs">
                                        {(data.strategy?.swot?.weaknesses || []).map((item: string, i: number) => <li key={i}>{item}</li>)}
                                    </ul>
                                </div>
                                <div className={`${colors.card} shadow-sm print-card`}>
                                    <h4 className="text-[#111827] font-bold mb-4 flex items-center"><TrendingUp className="w-4 h-4 mr-2" /> Opportunities</h4>
                                    <ul className="list-disc list-inside space-y-2 text-black/80 text-xs">
                                        {(data.strategy?.swot?.opportunities || []).map((item: string, i: number) => <li key={i}>{item}</li>)}
                                    </ul>
                                </div>
                                <div className={`${colors.card} shadow-sm print-card`}>
                                    <h4 className="text-amber-600 font-bold mb-4 flex items-center"><Shield className="w-4 h-4 mr-2" /> Threats</h4>
                                    <ul className="list-disc list-inside space-y-2 text-black/80 text-xs">
                                        {(data.strategy?.swot?.threats || []).map((item: string, i: number) => <li key={i}>{item}</li>)}
                                    </ul>
                                </div>
                            </div>
                        </div>

                        {data.strategy?.investment_debate && (
                            <div className="space-y-6 scroll-reveal mt-12">
                                <div className="flex items-center space-x-3">
                                    <Scale className="w-6 h-6 text-[#111827] no-print" />
                                    <h2 className="text-2xl font-bold text-[#111827] font-medium">Boardroom Debate: Bull Agent vs Bear Agent</h2>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    {/* Bull Agent (Pros) */}
                                    <div className="bg-emerald-50/30 border border-emerald-500/20 p-8 rounded-lg shadow-sm hover:translate-y-[-4px] transition-all duration-300 relative overflow-hidden group">
                                        <div className="absolute top-0 left-0 w-full h-1 bg-emerald-600"></div>
                                        <h3 className="text-lg font-bold text-emerald-800 mb-6 uppercase tracking-wider font-mono">Bull Agent: Reasons to Invest</h3>
                                        <ul className="space-y-4">
                                            {(data.strategy.investment_debate.bull_agent || data.strategy.investment_debate.blue_team || []).map((reason: string, i: number) => (
                                                <li key={i} className="flex items-start space-x-3">
                                                    <span className="text-emerald-600 font-bold text-lg leading-none mt-0.5">✓</span>
                                                    <span className="text-emerald-950 text-sm leading-relaxed font-medium">{renderBoldText(reason)}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>

                                    {/* Bear Agent (Cons) */}
                                    <div className="bg-rose-50/30 border border-rose-500/20 p-8 rounded-lg shadow-sm hover:translate-y-[-4px] transition-all duration-300 relative overflow-hidden group">
                                        <div className="absolute top-0 left-0 w-full h-1 bg-rose-600"></div>
                                        <h3 className="text-lg font-bold text-rose-800 mb-6 uppercase tracking-wider font-mono">Bear Agent: Reasons NOT to Invest</h3>
                                        <ul className="space-y-4">
                                            {(data.strategy.investment_debate.bear_agent || data.strategy.investment_debate.red_team || []).map((reason: string, i: number) => (
                                                <li key={i} className="flex items-start space-x-3">
                                                    <span className="text-rose-600 font-bold text-lg leading-none mt-0.5">✗</span>
                                                    <span className="text-rose-950 text-sm leading-relaxed font-medium">{renderBoldText(reason)}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                </div>

                                {/* Judge Agent Panel */}
                                <div className="bg-slate-50 border border-slate-200 p-8 rounded-lg shadow-sm relative overflow-hidden group">
                                    <div className="absolute top-0 left-0 w-full h-1 bg-slate-800"></div>
                                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                                        <div className="space-y-4 flex-1">
                                            <div className="flex items-center justify-between w-full">
                                                <div className="flex items-center space-x-2.5">
                                                    <div className="p-1.5 bg-slate-100 border border-slate-200 rounded-md">
                                                        <Scale className="w-5 h-5 text-slate-800" />
                                                    </div>
                                                    <h3 className="text-lg font-bold text-slate-800 uppercase tracking-wider font-mono">Judge Agent: Final Verdict</h3>
                                                </div>

                                            </div>
                                            
                                            <div>
                                                <span className={`inline-block px-4 py-1.5 rounded-none text-sm font-bold uppercase tracking-wider border font-mono ${
                                                    data.strategy.investment_debate.judge_verdict?.toLowerCase().includes('avoid')
                                                        ? 'bg-rose-50 text-rose-700 border-rose-200'
                                                        : data.strategy.investment_debate.judge_verdict?.toLowerCase().includes('condition')
                                                        ? 'bg-amber-50 text-amber-700 border-amber-200'
                                                        : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                                }`}>
                                                    {data.strategy.investment_debate.judge_verdict}
                                                </span>
                                            </div>

                                            <p className="text-slate-700 text-sm leading-relaxed font-medium">
                                                {renderBoldText(data.strategy.investment_debate.judge_reasoning)}
                                            </p>
                                        </div>

                                        <div className="flex flex-col items-center justify-center bg-white border border-slate-200 p-6 rounded-lg min-w-[200px] shadow-sm">
                                            <span className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Confidence Score</span>
                                            <div className="relative flex items-center justify-center">
                                                <svg className="w-24 h-24 transform -rotate-90">
                                                    <circle cx="48" cy="48" r="40" stroke="currentColor" strokeWidth="6" fill="transparent" className="text-slate-100" />
                                                    <circle
                                                        cx="48" cy="48" r="40"
                                                        stroke="currentColor" strokeWidth="6"
                                                        fill="transparent"
                                                        strokeDasharray={251}
                                                        strokeDashoffset={251 - (251 * (data.strategy.investment_debate.judge_confidence || 0)) / 100}
                                                        className="text-slate-800 transition-all duration-500 ease-in-out"
                                                    />
                                                </svg>
                                                <div className="absolute inset-0 flex items-center justify-center">
                                                    <span className="text-2xl font-bold text-slate-800 font-mono">{data.strategy.investment_debate.judge_confidence || 0}%</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {failedStartupsLoading && (
                            <div className="flex justify-center items-center py-12">
                                <div className="animate-pulse flex flex-col items-center">
                                    <div className="w-8 h-8 bg-[#111827] animate-spin mb-4"></div>
                                    <p className="text-[#4B5563] font-mono text-xs">Analyzing past failures in {industry}...</p>
                                </div>
                            </div>
                        )}

                        {failedStartupsData && failedStartupsData.startups && (
                            <div className="space-y-8 mt-12 bg-white p-8 rounded-none border-none shadow-none text-black scroll-reveal animate-fade-in">
                                {/* Section Header */}
                                <div className="flex items-center justify-between w-full border-b border-black/10 pb-6">
                                    <div className="flex items-center space-x-3">
                                        <AlertTriangle className="w-8 h-8 text-amber-500 no-print animate-pulse" />
                                        <h2 className="text-3xl font-bold text-black tracking-tight font-light">Ghost Town: <span className="text-[#111827] underline decoration-2 underline-offset-4 font-normal">Failed Startups</span></h2>
                                    </div>
                                    <div className="relative group no-print">
                                        <button 
                                            className="p-1 hover:bg-black/5 rounded-none text-black/40 hover:text-black transition-colors"
                                            title="Section Info"
                                        >
                                            <Info className="w-4.5 h-4.5" />
                                        </button>
                                        <div className="absolute top-full right-0 mt-2 hidden group-hover:block w-72 p-3 bg-white text-[#111827] text-xs leading-relaxed rounded-none shadow-lg border border-[#C0C0C0] z-[9999] pointer-events-none normal-case tracking-normal text-left font-sans select-none animate-fade-in">
                                            <div className="absolute bottom-full right-2 w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-b-[6px] border-b-[#C0C0C0]"></div>
                                            A curated database of historical failures in this industry, detailing their timeline, funding, and why they closed.
                                        </div>
                                    </div>
                                </div>



                                {failedStartupsData.summary && (
                                    <div className="p-8 bg-black/5 border-l-4 border-[#111827]">
                                        {renderSummaryAsBullets(failedStartupsData.summary)}
                                    </div>
                                )}

                                {/* Contrarian Take Section */}
                                {failedStartupsData.synthesis && failedStartupsData.synthesis.contrarian_take && (
                                     <div className="bg-black text-white p-8 border border-black relative">
                                         <div className="absolute top-0 right-0 p-4 font-mono text-[9px] uppercase tracking-widest text-white">
                                             Evidence-Backed Insight
                                         </div>
                                         <div className="flex items-center justify-between mb-6 w-full">
                                             <h3 className="text-xl font-bold text-white flex items-center font-mono uppercase tracking-wider">
                                                 <Scale className="w-5 h-5 mr-2 text-white" /> Contrarian Take
                                             </h3>
                                             <div className="relative group no-print">
                                                 <div className="p-1 cursor-help text-white/50 hover:text-white transition-colors">
                                                     <Info className="w-4 h-4" />
                                                 </div>
                                                 <div className="absolute top-full right-0 mt-2 hidden group-hover:block w-72 p-3 bg-white text-black text-xs leading-relaxed rounded-none shadow-xl border border-slate-200 z-[9999] pointer-events-none normal-case tracking-normal text-left font-sans select-none animate-fade-in">
                                                     <div className="absolute bottom-full right-2 w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-b-[6px] border-b-white"></div>
                                                     Deconstructs mainstream industry assumptions to reveal non-obvious realities and risks learned from post-mortem evidence.
                                                 </div>
                                             </div>
                                         </div>
                                         
                                         <div className="grid grid-cols-1 md:grid-cols-2 gap-8 relative z-10">
                                              <div className="space-y-2 border-l border-rose-500/30 pl-4">
                                                  <h4 className="text-xs uppercase font-mono tracking-wider text-rose-400 font-bold">Consensus View</h4>
                                                  <p className="text-sm text-white/80 leading-relaxed font-sans font-medium">
                                                      {failedStartupsData.synthesis.contrarian_take.consensus}
                                                  </p>
                                              </div>
                                              <div className="space-y-2 border-l border-emerald-500/30 pl-4">
                                                  <h4 className="text-xs uppercase font-mono tracking-wider text-emerald-400 font-bold">Contrarian Reality</h4>
                                                  <p className="text-sm text-white leading-relaxed font-sans font-semibold">
                                                      {failedStartupsData.synthesis.contrarian_take.reality}
                                                  </p>
                                              </div>
                                          </div>
                                     </div>
                                )}
                                
                                {/* Failed Startups Cards */}
                                <div className="grid grid-cols-1 gap-6">
                                    {failedStartupsData.startups.map((startup: any, i: number) => (
                                         <div key={i} className="p-8 md:p-10 bg-white border border-black/10 transition-all duration-[350ms] ease-out shadow-none print-card flex flex-col gap-6 relative overflow-hidden group hover:translate-y-[-6px] hover:border-[#111827] min-h-[360px]">
                                             <div className="absolute top-0 left-0 w-full h-1 bg-[#111827] transform scale-x-0 group-hover:scale-x-100 transition-transform origin-left duration-[350ms]"></div>
                                             
                                             <div className="flex justify-between items-start border-b border-black/10 pb-4">
                                                 <div>
                                                     <div className="flex items-center space-x-2">
                                                         <h3 className="text-2xl font-bold text-black group-hover:text-[#111827] transition-colors">{startup.name}</h3>
                                                         <a 
                                                             href={`https://www.google.com/search?q=why+${encodeURIComponent(startup.name)}+failed+startup+post+mortem`}
                                                             target="_blank"
                                                             rel="noopener noreferrer"
                                                             className="no-print p-1 hover:bg-black/5 rounded-none text-black/40 hover:text-black transition-colors"
                                                             title="Verify Source & Read Post-Mortem"
                                                         >
                                                             <Search className="w-3.5 h-3.5" />
                                                         </a>
                                                     </div>
                                                     <p className="text-[#4B5563] text-sm font-medium mt-1">{startup.sector}</p>
                                                      {(() => {
                                                          const rawSource = startup.source || "";
                                                          let sourceVal = rawSource;
                                                          if (!sourceVal) {
                                                              if (failedStartupsData.is_fallback) {
                                                                  sourceVal = `https://www.google.com/search?q=why+${encodeURIComponent(startup.name)}+failed+startup+post+mortem`;
                                                              } else {
                                                                  sourceVal = "Startup Failures (Tabular Dataset)";
                                                              }
                                                          }
                                                          return (
                                                              <div className="mt-2 flex items-center space-x-1 font-mono text-[9px] uppercase tracking-wider">
                                                                  {sourceVal.startsWith('http') ? (
                                                                      <a 
                                                                          href={sourceVal} 
                                                                          target="_blank" 
                                                                          rel="noopener noreferrer" 
                                                                          className="bg-blue-50 text-blue-700 px-2 py-0.5 border border-blue-200 hover:bg-blue-100/50 transition-colors flex items-center font-bold"
                                                                      >
                                                                          🌐 Source: Web Grounding
                                                                      </a>
                                                                  ) : (
                                                                      <span className="bg-emerald-50 text-emerald-800 px-2 py-0.5 border border-emerald-200 font-bold">
                                                                          📊 Source: {sourceVal}
                                                                      </span>
                                                                  )}
                                                              </div>
                                                          );
                                                      })()}
                                                 </div>
                                                 <div className="flex flex-col items-end space-y-2">
                                                     <div className="bg-black/5 px-3 py-1 rounded-none border border-black/10">
                                                         <span className="text-xs text-black/75 font-mono font-medium">{startup.years_of_operation}</span>
                                                     </div>
                                                     <div className="text-[10px] font-mono bg-black/5 px-2 py-0.5 border border-black/10 font-bold">
                                                         Match: {startup.similarity_percentage || 50}%
                                                     </div>
                                                 </div>
                                             </div>
                                             
                                             <div className="grid grid-cols-1 md:grid-cols-2 gap-6 flex-grow">
                                                 <div className="space-y-4">
                                                     <div>
                                                         <span className="text-[10px] text-black/40 uppercase tracking-brand font-bold block mb-1 font-mono">What They Did</span>
                                                         <p className="text-sm text-black/80 leading-relaxed">{startup.product_type}</p>
                                                     </div>
                                                     
                                                     <div className="bg-red-50/50 p-4 border border-red-200/40">
                                                         <span className="text-[10px] text-red-600 uppercase tracking-brand font-bold block mb-2 font-mono">Why They Failed</span>
                                                         <p className="text-sm text-red-700/80 leading-relaxed">{startup.failure_analysis}</p>
                                                     </div>
                                                 </div>

                                                 {/* Similarity Explanation / Feature Checklist */}
                                                 <div className="bg-black/5 p-4 border border-black/10 flex flex-col justify-between space-y-4">
                                                     <div>
                                                         <span className="text-[10px] text-[#111827] uppercase tracking-brand font-bold block mb-2 font-mono">Concept Similarity Check</span>
                                                         <div className="space-y-2">
                                                             {(startup.matched_features || []).map((feat: string, idx: number) => (
                                                                 <div key={idx} className="flex items-start space-x-2 text-xs text-emerald-800">
                                                                     <span className="font-bold flex-shrink-0 text-emerald-600">✓</span>
                                                                     <span className="font-medium">{feat.replace(/^[✓\s✗]+/, '')}</span>
                                                                 </div>
                                                             ))}
                                                             {(startup.different_features || []).map((feat: string, idx: number) => (
                                                                 <div key={idx} className="flex items-start space-x-2 text-xs text-rose-800">
                                                                     <span className="font-bold flex-shrink-0 text-rose-600">✗</span>
                                                                     <span className="font-medium">{feat.replace(/^[✓\s✗]+/, '')}</span>
                                                                 </div>
                                                             ))}
                                                         </div>
                                                     </div>
                                                     <div className="w-full bg-black/10 h-1 rounded-none overflow-hidden">
                                                         <div 
                                                             className="bg-black/80 h-full" 
                                                             style={{ width: `${startup.similarity_percentage || 50}%` }}
                                                         ></div>
                                                     </div>
                                                 </div>
                                             </div>
                                             
                                             <div className="mt-auto pt-5 border-t border-black/10 flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
                                                <div className="sm:w-2/3 pr-4">
                                                    <span className="text-[10px] text-[#111827] uppercase tracking-brand font-bold block mb-1 font-mono">Key Learning</span>
                                                    <p className="text-sm text-black/85 font-medium">{startup.learnings}</p>
                                                </div>
                                                <div className="sm:w-1/3 sm:text-right flex-shrink-0">
                                                    <span className="text-[10px] text-black/40 uppercase tracking-brand font-bold block mb-1 font-mono">Cash Burned</span>
                                                    <span className="text-lg text-black font-bold">{formatCurrency(startup.cash_burned, currency)}</span>
                                                </div>
                                             </div>
                                         </div>
                                     ))}
                                  </div>
                                  
                                  {/* Startup Risk Graph Section */}
                                  {failedStartupsData.risk_graph && (
                                      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 bg-black/5 p-6 border border-black/10 mt-12">
                                          <div className="lg:col-span-1 flex flex-col justify-between space-y-4">
                                              <div className="flex items-center justify-between w-full mb-1">
                                                  <h3 className="text-lg font-bold text-[#111827] flex items-center font-mono uppercase tracking-wider">
                                                      <BarChart3 className="w-5 h-5 mr-2 text-[#111827]" /> Startup Risk Graph
                                                  </h3>
                                                  <div className="relative group no-print">
                                                       <div className="p-1 cursor-help text-black/40 hover:text-black transition-colors">
                                                           <Info className="w-4 h-4" />
                                                       </div>
                                                       <div className="absolute top-full right-0 mt-2 hidden group-hover:block w-72 p-3 bg-white text-[#111827] text-xs leading-relaxed rounded-none shadow-lg border border-[#C0C0C0] z-[9999] pointer-events-none normal-case tracking-normal text-left font-sans select-none animate-fade-in">
                                                           <div className="absolute bottom-full right-2 w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-b-[6px] border-b-[#C0C0C0]"></div>
                                                           A visual clustering of historical risk categories showing where past startups in your space failed most frequently.
                                                       </div>
                                                   </div>
                                              </div>
                                              <p className="text-sm text-black/85 leading-relaxed font-medium font-sans">
                                                  {failedStartupsData.risk_graph.summary}
                                              </p>
                                          </div>
                                          <div className="lg:col-span-2 space-y-3 flex flex-col justify-center">
                                              {Object.entries(failedStartupsData.risk_graph.clusters || {}).map(([category, percentage]: [string, any]) => (
                                                  <div key={category} className="space-y-1">
                                                      <div className="flex justify-between text-xs font-bold">
                                                          <span className="font-mono text-black/75">{category}</span>
                                                          <span className="font-mono text-[#111827]">{percentage}%</span>
                                                      </div>
                                                      <div className="w-full bg-black/10 h-2 rounded-none overflow-hidden">
                                                          <div 
                                                              className="bg-[#111827] h-full transition-all duration-1000 ease-out" 
                                                              style={{ width: `${percentage}%` }}
                                                          ></div>
                                                      </div>
                                                  </div>
                                              ))}
                                          </div>
                                      </div>
                                  )}
                             </div>
                         )}

                        {failedStartupsData && failedStartupsData.error && (
                            <div className="space-y-6 mt-12 bg-white p-8 rounded-none border border-red-200/50 animate-fade-in shadow-none text-black">
                                <div className="flex items-center space-x-3 text-red-600">
                                    <AlertTriangle className="w-8 h-8 no-print" />
                                    <h2 className="text-2xl font-bold">Failed Startups Analysis Error</h2>
                                </div>
                                <div className="p-4 bg-black/5 border border-black/10">
                                    <p className="text-black/80 leading-relaxed font-medium">It looks like the RAG engine couldn't start: <strong>{failedStartupsData.error}</strong></p>
                                </div>
                            </div>
                        )}

                        {/* Agent Audit trail collapsible log */}
                        {logs.length > 0 && (
                            <div className="mt-12 border border-black/10 bg-[#FAF9F6] p-6 no-print">
                                <button 
                                    onClick={() => setIsLogsCollapsed(!isLogsCollapsed)}
                                    className="w-full flex items-center justify-between font-mono text-sm text-[#111827] focus:outline-none"
                                >
                                    <div className="flex items-center space-x-3">
                                        <span className="text-[#111827] font-bold">&gt;_ REAL-TIME PROACTIVE LOG MONITOR</span>
                                        <span className="px-2 py-0.5 text-[10px] bg-emerald-100 text-emerald-800 font-bold rounded-none uppercase">VERIFIED</span>
                                    </div>
                                    <div className="flex items-center space-x-2 text-xs text-[#4B5563]">
                                        <span>{isLogsCollapsed ? "EXPAND AUDIT LOG" : "COLLAPSE AUDIT LOG"}</span>
                                        <span className="font-bold transform transition-transform duration-200">{isLogsCollapsed ? "+" : "-"}</span>
                                    </div>
                                </button>
                                
                                {!isLogsCollapsed && (
                                    <div className="mt-4 bg-[#0f0e0d] text-[#e6dfd9] border border-[#26211e] p-5 font-mono text-sm leading-relaxed max-h-[300px] overflow-y-auto flex flex-col rounded-none">
                                        <div className="flex items-center justify-between border-b border-[#26211e] pb-2 mb-3 text-xs text-[#8e857b] tracking-wider select-none">
                                            <span className="text-[#d67b5c] font-bold">&gt;_ AGENT TRACE LOGS</span>
                                            <span>COMPLETED</span>
                                        </div>
                                        <div className="space-y-2 overflow-y-auto">
                                            {logs.map((log, index) => {
                                                const match = log.match(/^\[(.*?)\] (.*)$/);
                                                if (match) {
                                                    const [, time, msg] = match;
                                                    return (
                                                        <div key={index} className="flex items-start space-x-2 text-[#ccc] hover:text-white transition-colors duration-150 text-left">
                                                            <span className="text-[#d67b5c] select-none font-semibold flex-shrink-0">[{time}]</span>
                                                            <span className="font-light">{msg}</span>
                                                        </div>
                                                    );
                                                }
                                                return <div key={index} className="text-[#ccc] font-light text-left">{log}</div>;
                                            })}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="p-8 rounded-none bg-[#111827] text-white shadow-none border border-white/10 relative overflow-hidden mt-12 mb-8 group no-print">
                            <div className="flex flex-col md:flex-row items-center justify-between relative z-10 gap-6">
                                <div className="space-y-4 max-w-2xl text-center md:text-left">
                                    <div className="flex items-center justify-center md:justify-start space-x-3">
                                        <div className="p-2 bg-white/10 rounded-none border border-white/20">
                                            <Zap className="w-6 h-6 text-white" />
                                        </div>
                                        <h3 className="text-3xl font-bold text-white tracking-tight font-light">Need Expert Guidance?</h3>
                                    </div>
                                    <p className="text-white/90 text-lg leading-relaxed font-light">
                                        Take your startup from idea to execution with our <span className="text-white font-bold font-sans">Pro Plan</span>. Get 1-on-1 mentorship, pitch deck reviews, and deep-dive strategy sessions with industry experts.
                                    </p>
                                </div>
                                
                                <button 
                                    onClick={() => setShowPricing(true)}
                                    className="w-full md:w-auto px-8 py-4 bg-white text-black border border-white hover:bg-black hover:text-white rounded-none font-bold transition-all duration-300 flex items-center justify-center space-x-3 flex-shrink-0 cursor-pointer"
                                >
                                    <span>Upgrade to Pro</span>
                                    <ArrowRight className="w-5 h-5" />
                                </button>
                            </div>
                        </div>

                        <div className="flex flex-col sm:flex-row items-center justify-center space-y-4 sm:space-y-0 sm:space-x-8 mt-12 pt-8 border-t border-white/10 no-print">
                            <button
                                onClick={() => setData(null)}
                                className={`${colors.buttonSecondary} w-full sm:w-auto`}
                            >
                                Evaluate Another Idea
                            </button>
                            <button
                                onClick={handlePrint}
                                className={`${colors.buttonPrimary} w-full sm:w-auto`}
                            >
                                <Download className="w-5 h-5 mr-2" />
                                <span>Download & Print</span>
                            </button>
                        </div>

                    </div>
                )}
            </div>

            {/* Pricing Modal */}
            {showPricing && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                    <div 
                        className="absolute inset-0 bg-black/50 transition-opacity" 
                        onClick={() => setShowPricing(false)}
                    ></div>
                    
                    <div className="relative bg-white border border-black p-8 max-w-lg w-full shadow-none rounded-none max-h-[90vh] overflow-y-auto no-scrollbar group">
                        <div className="absolute top-0 left-0 w-full h-1 bg-[#111827]"></div>
                        
                        <button 
                            onClick={() => setShowPricing(false)} 
                            className="absolute top-4 right-4 text-black/40 hover:text-black transition-colors cursor-pointer"
                            aria-label="Close"
                        >
                            <X className="w-6 h-6" />
                        </button>
                        
                        <div className="text-center mb-8">
                            <h3 className="text-3xl font-bold text-black mb-2">StartupLens <span className="text-[#111827] font-bold">Pro</span></h3>
                            <p className="text-black/60 text-sm">Everything you need to successfully launch.</p>
                        </div>

                        <div className="flex justify-center mb-8">
                            <div className="text-center bg-black/5 p-6 rounded-none border border-black/10 w-full">
                                <span className="text-5xl font-bold text-black font-mono">$30</span>
                                <span className="text-black/60 ml-2 font-mono">/ month</span>
                            </div>
                        </div>

                        <div className="space-y-4 mb-8">
                            {[
                                "Unlimited AI Analysis Reports",
                                "1-on-1 Strategy Session with Experts",
                                "Pitch Deck Review & Feedback",
                                "Investor-Ready Financial Projections",
                                "Advanced Market Competitor Tracking"
                            ].map((feature, i) => (
                                <div key={i} className="flex items-center space-x-3 text-sm text-black/80">
                                    <CheckCircle className="w-5 h-5 text-emerald-600 flex-shrink-0" />
                                    <span>{feature}</span>
                                </div>
                            ))}
                        </div>

                        <div className="space-y-3 mt-6">
                            <button 
                                className="w-full bg-[#111827] py-3 text-white rounded-none border border-[#111827] hover:bg-[#4B5563] font-bold transition-all duration-300 text-xs tracking-wider uppercase cursor-pointer"
                                onClick={() => {
                                    setShowPricing(false);
                                    onBack('pricing');
                                }}
                            >
                                View All Plans
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Methodology Modal */}
            {showMethodology && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                    <div 
                        className="absolute inset-0 bg-black/50 transition-opacity" 
                        onClick={() => setShowMethodology(false)}
                    ></div>
                    
                    <div className="relative bg-white border border-black p-5 md:p-6 max-w-2xl w-full shadow-none rounded-none max-h-[95vh] overflow-y-auto no-scrollbar">
                        <div className="flex items-center justify-between mb-4 border-b border-black/10 pb-2">
                            <div className="flex items-center space-x-2 text-[#111827]">
                                <Info className="w-5 h-5" />
                                <h3 className="text-xl font-bold text-black">Analysis Methodology</h3>
                            </div>
                            <button onClick={() => setShowMethodology(false)} className="text-black/40 hover:text-black transition-colors cursor-pointer">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                            <div className="p-4 bg-black/5 rounded-none border border-black/10 space-y-1.5 shadow-none">
                                <div className="p-1.5 bg-black/5 rounded-none border border-black/10 w-fit">
                                    <Activity className="w-4 h-4 text-[#111827]" />
                                </div>
                                <h4 className="font-bold text-black uppercase text-[10px] tracking-wider font-mono">Agentic Reasoning</h4>
                                <p className="text-xs text-black/70 leading-relaxed">
                                    Our system uses <span className="text-[#111827] font-semibold">Multi-Agent Orchestration</span>. Point-agents gather raw data, Analyst-agents process and weigh details to output the Viability Score.
                                </p>
                            </div>
                            
                            <div className="p-4 bg-black/5 rounded-none border border-black/10 space-y-1.5 shadow-none">
                                <div className="p-1.5 bg-emerald-50 rounded-none border border-emerald-200/50 w-fit">
                                    <Search className="w-4 h-4 text-emerald-700" />
                                </div>
                                <h4 className="font-bold text-black uppercase text-[10px] tracking-wider font-mono">RAG Failure Mapping</h4>
                                <p className="text-xs text-black/70 leading-relaxed">
                                    Metrics are grounded using <span className="text-emerald-700 font-semibold">Retrieval-Augmented Generation</span>. The AI maps your idea against a database of verified startup failures.
                                </p>
                            </div>

                            <div className="p-4 bg-black/5 rounded-none border border-black/10 space-y-1.5 shadow-none md:col-span-2">
                                <div className="p-1.5 bg-amber-50 rounded-none border border-amber-200/50 w-fit">
                                    <BarChart2 className="w-4 h-4 text-amber-700" />
                                </div>
                                <h4 className="font-bold text-black uppercase text-[10px] tracking-wider font-mono">Heuristic Weighting & Formula</h4>
                                <p className="text-xs text-black/70 leading-relaxed mb-2">
                                    The 0-100 score is calculated based on <span className="text-amber-700 font-semibold">6 Core Heuristics</span>: Market Density (20%), Entry Barrier (15%), Capital Intensity (15%), Trends & Timing (20%), Operational Complexity (15%), and Scalability (15%).
                                </p>
                                <div className="p-3 bg-[#0f0e0d] border border-[#26211e] rounded-none font-mono text-[11px] text-[#e6dfd9] select-all overflow-x-auto whitespace-nowrap">
                                    Viability Score = (Market Density × 0.20) + (Entry Barrier × 0.15) + (Capital Intensity × 0.15) + (Trends × 0.20) + (Complexity × 0.15) + (Scalability × 0.15)
                                </div>
                            </div>

                            <div className="p-4 bg-black/5 rounded-none border border-black/10 space-y-1.5 shadow-none">
                                <div className="p-1.5 bg-purple-50 rounded-none border border-purple-200/50 w-fit">
                                    <Target className="w-4 h-4 text-purple-700" />
                                </div>
                                <h4 className="font-bold text-black uppercase text-[10px] tracking-wider font-mono">Market Inferencing</h4>
                                <p className="text-xs text-black/70 leading-relaxed">
                                    Financials are not generic; they are <span className="text-purple-700 font-semibold">Inferred Projections</span>. By analyzing competitor CAC, the AI simulates a realistic breakeven timeline.
                                </p>
                            </div>
                        </div>

                        <div className="bg-[#111827]/5 p-4 border border-[#111827]/10 rounded-none">
                            <p className="text-xs text-black/85 leading-relaxed italic text-center">
                                "The AI serves as a <strong>Decision Support System</strong>, synthesizing millions of data points into a strategic draft. For production deployment, these metrics should be validated against actual primary market research."
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {/* Currency Tour Highlight Overlay */}
            {showCurrencyTip && (
                <div 
                    className="fixed inset-0 z-[9999] bg-black/85 cursor-pointer animate-fade-in"
                    onClick={() => setShowCurrencyTip(false)}
                ></div>
            )}
            </div>
        </div>
    );
}

export default Dashboard;
