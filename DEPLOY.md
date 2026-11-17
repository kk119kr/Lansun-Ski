# 랜선 스키장 배포 가이드 (전부 무료 / 폰 브라우저만으로 가능)

구조
- `web/`    : 게임 화면 → Vercel
- `server/` : 멀티플레이 서버 → Cloudflare Workers (Durable Objects)

## 0. GitHub에 올리기
1. GitHub 가입 → New repository (`ski-resort`, Public/Private 아무거나)
2. 이 폴더(zip 풀어서) 통째로 업로드 — 웹에서 "Add file → Upload files"로 `web`, `server`, `.gitignore` 등을 끌어다 놓으면 돼요.

## 1. 서버: Cloudflare
1. cloudflare.com 가입(무료) → 대시보드 **Workers & Pages → Create → Import a repository(GitHub)**
2. 저장소 선택 → 프로젝트(Worker) 이름은 **ski-server** 그대로 (`server/wrangler.toml`의 name과 같아야 해요)
3. **Advanced settings → Root directory** 에 `/server` 입력
4. 배포 명령은 기본값 `npx wrangler deploy` 그대로 → **Deploy**
5. 끝나면 주소가 나와요: `https://ski-server.<내서브도메인>.workers.dev`
   - 이 주소 뒤에 `/health` 붙여서 열었을 때 `ok`가 보이면 서버 정상

## 2. 접속 주소 넣기
1. GitHub에서 `web/config.js` 열고 연필(Edit) 눌러 수정:
   `window.SKI_SERVER='wss://ski-server.<내서브도메인>.workers.dev/ws';`
   (https → **wss**, 끝에 **/ws**)
2. Commit

## 3. 화면: Vercel
1. vercel.com 가입(GitHub 계정으로) → **Add New → Project** → 저장소 Import
2. **Root Directory = `web`**, Framework Preset = **Other**, Build Command 비움 → **Deploy**
3. 나온 `https://….vercel.app` 주소를 친구들에게 공유. 이후 GitHub에 커밋하면 자동 재배포돼요.

## 한도 (Cloudflare 무료)
- 하루 100,000 요청, 서버 실행시간 하루 13,000 GB-초 (매일 UTC 0시 = 한국 오전 9시 초기화)
- 서버가 받는 메시지는 20개 = 1요청으로 계산, 보내는 메시지는 무료
- 이 게임은 한 명이 초당 5번 위치를 보내서 1시간에 약 900요청 → 하루 약 110 "인·시간"
  (30명이 동시에 3~4시간 정도). 넘으면 그날은 새 접속·전송이 실패하고 다음날 복구돼요.
- 더 필요하면 Workers 유료($5/월)로 올리면 돼요.

## 조정하고 싶을 때
- 동시 접속 상한: `server/worker.js` 맨 위 `MAX_PLAYERS` (기본 40)
- 전송 빈도: `web/index.html`의 `SEND_GAP` (기본 0.2초 = 초당 5번, 올리면 한도를 덜 써요)

## PC가 있다면 (선택)
`server/` 에서 `npm install` → `npx wrangler login` → `npx wrangler deploy`
로컬 테스트: `npx wrangler dev` 후 config.js를 `ws://127.0.0.1:8787/ws` 로.
