# 반딧불 미로

밤 정원 미로 추격 웹게임. 빌드 단계 없는 순수 정적 사이트(HTML/CSS/JS, 약 37KB)로 Cloudflare Pages Free 플랜에 배포합니다.

## 구조
```
public/
  index.html   마크업
  style.css    스타일
  game.js      게임 로직 (Canvas 2D + Web Audio)
  _headers     보안 헤더(CSP 등)·캐시 정책 — Cloudflare Pages가 읽음
  favicon.svg, robots.txt
wrangler.toml  Pages 설정 (출력 폴더 = public)
```

## 로컬 실행
```bash
npx serve public
```

## Cloudflare Pages 배포 (Git 연동, 최초 1회)
1. Cloudflare 대시보드 → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**
2. 이 저장소 선택
3. Framework preset: **None** · Build command: *(비워둠)* · Build output directory: **public**
4. **Save and Deploy** → `https://<프로젝트명>.pages.dev` 생성

이후 `main` 브랜치에 push하면 자동 배포되고, 다른 브랜치는 미리보기 URL이 생깁니다.

## Free 플랜 한도 (이 프로젝트 기준)
| 항목 | 한도 | 사용량 |
|---|---|---|
| 정적 요청·대역폭 | 무제한 | — |
| 빌드 | 월 500회 | push 1회 = 1빌드 |
| 파일 수 / 크기 | 20,000개 / 개당 25MB | 6개 / 37KB |
| 커스텀 도메인 | 프로젝트당 100개 | 선택 |

서버 코드(Functions)·DB·KV를 쓰지 않으므로 요청량 과금 위험이 없습니다. 최고 기록은 브라우저 `localStorage`에만 저장됩니다.
