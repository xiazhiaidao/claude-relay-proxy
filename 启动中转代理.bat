@echo off
title Claude Code 中转代理 (Token Rhythm)
echo ============================================
echo  Claude Code 中转代理服务
echo  代理地址: http://127.0.0.1:5678
echo  目标中转: https://tokenrhythm.studio
echo  功能: 自动剥离不兼容的 anthropic-beta 头
echo ============================================
echo.
echo [启动中...] 按 Ctrl+C 停止
echo.
node "%~dp0relay-proxy.js"
pause
