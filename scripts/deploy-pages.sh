#!/usr/bin/env bash
# deploy-pages.sh — 一键部署练习页到 GitHub Pages
#
# 前提（一次性）：
#   1. 注册 GitHub 账号：https://github.com/signup
#   2. 新建空仓库（不要勾选 README）：https://github.com/new  → 名字如 espanol
#   3. 本机执行：git remote add origin https://github.com/<你的用户名>/<仓库名>.git
#   4. 首次推送需要凭证：网页里 Settings → Developer settings → Personal access
#      tokens → Generate new token（勾选 repo）→ 复制 token；push 时用户名填
#      你的 GitHub 用户名，密码填 token（macOS 会记住，之后不用再输）
#   5. 网页开启 Pages：仓库 Settings → Pages → Source 选 "Deploy from a branch"
#      → Branch 选 main / root → Save
#
# 之后每次更新内容，只需：
#   bash scripts/deploy-pages.sh
#
# 发布地址：https://<你的用户名>.github.io/<仓库名>/app/
set -e
cd "$(dirname "$0")/.."

echo "=== 1/3 内容自检（音频链路 + 媒体头）==="
node scripts/verify-audio.mjs || { echo "❌ 内容有问题，先修复再部署"; exit 1; }

echo "=== 2/3 构建发布内容 ==="
# 确保生成的产物与原始素材同步（幂等，无变化则不重复生成）
node scripts/build-pack.mjs --all
node scripts/generate-audio.mjs --all >/dev/null 2>&1 || echo "（音频已是最新，跳过）"

echo "=== 3/3 提交并推送 ==="
git add -A
if git diff --cached --quiet; then
  echo "没有新改动，直接推送"
else
  git commit -m "deploy: 内容更新 $(date '+%Y-%m-%d %H:%M')" || true
fi
git push origin main
echo "✅ 已推送。GitHub Pages 约 1-2 分钟后自动更新："
echo "   https://$(git config --get remote.origin.url | sed -E 's#https://github.com/([^/]+)/.*#\1#').github.io/$(basename $(git rev-parse --show-toplevel))/app/"
