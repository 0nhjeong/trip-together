# 같이갈래 — 링크 하나로 함께 짜는 국내 여행 계획

회원가입 없이 방 링크(`?room=코드`)만 공유하면, 닉네임을 정하고 바로 함께 지도에 핀을 찍고 일정을 짜는 모바일 웹앱입니다.
GitHub Pages 같은 정적 호스팅에 그대로 올릴 수 있습니다(빌드 과정 없음).

## 파일 구조

```
index.html            화면 뼈대
config.js             ★ 키 입력 자리 (Kakao JS Key / Supabase URL·Anon Key)
supabase.sql          ★ Supabase SQL Editor에 붙여넣을 테이블 생성 SQL
css/style.css         디자인 (오프화이트 · 코랄 · 딥티얼, Pretendard)
js/app.js             화면/상태/이벤트
js/store.js           저장 + 실시간 공유 (Supabase / 데모용 localStorage)
js/map/mapService.js  지도·검색 추상화 (provider 선택, 외부 링크)
js/map/kakaoProvider.js  카카오맵 + Places 키워드 검색 + 좌표→주소
js/map/demoProvider.js   키 없을 때 쓰는 가짜 지도 + 부산 샘플 검색
js/map/pinEl.js       핀 모양, 꾹 누르기 감지 (provider 공용)
serve.ps1             로컬 테스트 서버 (Windows)
```

## 데모 모드

`config.js`의 키가 비어 있으면 자동으로 데모 모드로 실행됩니다.

- 카카오 키 없음: 가짜 지도와 부산 샘플 데이터로 검색 (예: `광안리 국밥`, `해운대 카페`)
- Supabase 키 없음: 이 브라우저에만 저장됩니다. 같은 브라우저의 다른 탭끼리는 실시간으로 동기화됩니다.

## 1) Supabase 설정 (실시간 공유·저장)

1. https://supabase.com 에 가입하고 **New project**를 만듭니다. 리전은 Northeast Asia (Seoul)을 권장합니다.
2. 왼쪽 메뉴 **SQL Editor → New query**에 `supabase.sql` 내용을 전부 붙여넣고 **Run**을 누릅니다. 테이블 생성, anon 역할 GRANT, RLS 정책, Realtime 설정이 한 번에 됩니다. 여러 번 실행해도 안전합니다.
3. **Project Settings → API**(또는 Data API)에서 아래 두 값을 복사해 `config.js`에 넣습니다.
   - Project URL → `SUPABASE_URL`
   - `anon` `public` key → `SUPABASE_ANON_KEY`
   - ⚠️ `service_role` 키는 절대 넣지 마세요.
4. (확인) **Database → Publications → supabase_realtime**에 rooms/places/memos/votes가 켜져 있으면 됩니다. SQL이 자동으로 켭니다.

## 2) 카카오맵 JavaScript 키 발급 + 도메인 등록

1. https://developers.kakao.com 에 로그인하고 **내 애플리케이션 → 애플리케이션 추가하기**를 누릅니다.
2. **앱 키**에서 **JavaScript 키**를 복사해 `config.js`의 `KAKAO_JS_KEY`에 넣습니다.
3. **플랫폼 → Web 플랫폼 등록 → 사이트 도메인**에 아래 주소를 추가합니다. 경로 없이 도메인만 넣습니다.
   - `https://<깃허브아이디>.github.io`
   - 로컬 테스트용: `http://localhost:8080`
4. **카카오맵 사용 설정**: 앱 설정(또는 제품 설정)의 **카카오맵** 메뉴에서 사용 설정을 **ON**으로 바꿉니다. 2024년 말 이후 새로 만든 앱은 이 설정을 켜야 지도가 뜹니다.
5. 키나 도메인이 잘못돼도 앱은 멈추지 않고 데모 지도로 바뀌며, 하단 배너에 오류가 표시됩니다.

## 3) GitHub Pages 배포

1. 이 폴더를 GitHub 저장소에 push합니다.
2. 저장소 **Settings → Pages → Build and deployment**에서 Source를 `Deploy from a branch`, Branch를 `main` / `(root)`로 정하고 저장합니다.
3. 1~2분 뒤 `https://<아이디>.github.io/<저장소이름>/`로 접속합니다. 모든 경로가 `./` 상대경로라 하위 경로에서도 동작합니다.

## 로컬에서 실행

```powershell
powershell -ExecutionPolicy Bypass -File serve.ps1
```
그다음 http://localhost:8080 을 엽니다. ES 모듈을 쓰기 때문에 `index.html`을 더블클릭해서 열면 동작하지 않습니다.

## 해외 지도 추가하기

`js/map/mapService.js` 맨 위 주석에 Provider 인터페이스가 정리돼 있습니다.

1. `js/map/googleProvider.js`처럼 같은 메서드(`init`, `setMarkers`, `setRoutes`, `panTo`, `fitTo`, `search`, `reverseGeocode`, `links` 등)를 구현합니다.
2. `PROVIDERS`에 등록합니다.
3. `config.js`의 `MAP_PROVIDER`를 바꿉니다.

`app.js`는 고칠 필요가 없습니다.

## 보안 참고

로그인이 없는 링크 공유 방식이라, 방 코드(7자리 무작위)를 아는 사람은 누구나 그 방을 보고 편집할 수 있습니다.
anon 키는 공개돼도 되는 키지만, 민감한 개인정보는 메모에 적지 마세요.
