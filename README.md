# 반딧불 미로

밤 정원 미로 추격 웹게임. 빌드 단계 없는 순수 정적 사이트(HTML/CSS/JS, 약 37KB)로 Cloudflare Workers(정적 자산) Free 플랜에 배포합니다.

## 구조
```
public/
  index.html   마크업
  style.css    스타일
  game.js      게임 로직 (Canvas 2D + Web Audio)
  _headers     보안 헤더(CSP 등)·캐시 정책 — Cloudflare가 읽음 (서빙되지 않음)
  404.html     없는 경로 안내
  favicon.svg, robots.txt
wrangler.toml  Workers 정적 자산 설정 (assets.directory = public)
```

## 로컬 실행
```bash
npx serve public
```

## Cloudflare 배포 (Workers Git 연동)
대시보드 → **Workers & Pages** → **Create** → **Import a repository** → 이 저장소 선택.
- Project name: `wrangler.toml`의 `name`과 동일(`firefly-maze`)
- Build command: *(비워둠)* · Deploy command: `npx wrangler deploy`

이후 `main`에 push하면 자동 배포됩니다.

## Free 플랜 한도 (이 프로젝트 기준)
| 항목 | 한도 | 사용량 |
|---|---|---|
| 정적 요청·대역폭 | 무제한 | — |
| 빌드 | 월 500회 | push 1회 = 1빌드 |
| 파일 수 / 크기 | 20,000개 / 개당 25MB | 6개 / 37KB |
| 커스텀 도메인 | 프로젝트당 100개 | 선택 |

Worker 스크립트·DB·KV를 쓰지 않으므로 요청량 과금 위험이 없습니다. 최고 기록은 브라우저 `localStorage`에만 저장됩니다.
