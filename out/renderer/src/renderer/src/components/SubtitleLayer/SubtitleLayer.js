import { jsx as _jsx } from "react/jsx-runtime";
import { useState, useEffect } from 'react';
export default function SubtitleLayer({ currentTime = 0 }) {
    const [tracks, setTracks] = useState([]);
    const [activeTrackIndex, setActiveTrackIndex] = useState(0);
    const [currentCue, setCurrentCue] = useState(null);
    // 解析 SRT 格式字幕
    const parseSRT = (content) => {
        const cues = [];
        const blocks = content.trim().split(/\n\n+/);
        for (const block of blocks) {
            const lines = block.split('\n');
            if (lines.length < 3)
                continue;
            const timeMatch = lines[1].match(/(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/);
            if (!timeMatch)
                continue;
            const start = +timeMatch[1] * 3600 + +timeMatch[2] * 60 + +timeMatch[3] + +timeMatch[4] / 1000;
            const end = +timeMatch[5] * 3600 + +timeMatch[6] * 60 + +timeMatch[7] + +timeMatch[8] / 1000;
            const text = lines.slice(2).join('\n');
            cues.push({ start, end, text });
        }
        return cues;
    };
    // 加载字幕
    const loadSubtitle = async (url, label, language = 'zh') => {
        try {
            const res = await fetch(url);
            const content = await res.text();
            const cues = parseSRT(content);
            setTracks((prev) => [...prev, { label, language, cues }]);
        }
        catch {
            // 字幕加载失败静默处理
        }
    };
    // 根据当前时间查找字幕
    useEffect(() => {
        if (tracks.length === 0)
            return;
        const track = tracks[activeTrackIndex];
        if (!track)
            return;
        const cue = track.cues.find((c) => currentTime >= c.start && currentTime <= c.end);
        setCurrentCue(cue || null);
    }, [currentTime, tracks, activeTrackIndex]);
    // 暴露加载方法
    useEffect(() => {
        const handler = (e) => {
            const { url, label, language } = e.detail;
            loadSubtitle(url, label, language);
        };
        window.addEventListener('subtitle:load', handler);
        return () => window.removeEventListener('subtitle:load', handler);
    }, []);
    if (!currentCue)
        return null;
    return (_jsx("div", { className: "absolute bottom-16 left-0 right-0 z-20 flex justify-center pointer-events-none", children: _jsx("div", { className: "px-4 py-2 bg-black/70 rounded-lg max-w-[80%]", children: _jsx("p", { className: "text-white text-center text-base leading-relaxed whitespace-pre-line", style: { textShadow: '1px 1px 2px rgba(0,0,0,0.8)' }, children: currentCue.text }) }) }));
}
/**
 * 加载字幕的辅助函数
 */
export function loadSubtitleTrack(url, label, language = 'zh') {
    window.dispatchEvent(new CustomEvent('subtitle:load', { detail: { url, label, language } }));
}
