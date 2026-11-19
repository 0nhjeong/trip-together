/* ============================================================
 *  같이갈래 — 설정 파일 (여기만 채우면 됩니다)
 * ------------------------------------------------------------
 *  - 값이 비어 있으면 자동으로 "데모 모드"로 동작합니다.
 *      · KAKAO_JS_KEY 비어 있음  → 가짜(데모) 지도 + 부산 샘플 검색
 *      · SUPABASE_* 비어 있음    → 이 브라우저(localStorage)에만 저장
 *  - Anon Key는 공개돼도 되는 키입니다(브라우저용). service_role 키는 절대 넣지 마세요.
 * ============================================================ */
window.APP_CONFIG = {
  // ① 카카오 디벨로퍼스 > 내 애플리케이션 > 앱 키 > "JavaScript 키"
  KAKAO_JS_KEY: 'fd93359ae54d53c98ebe678cda0043ba',

  // ② Supabase > Project Settings > API
  SUPABASE_URL: 'https://vxupbhsespcaqzchbzmz.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ4dXBiaHNlc3BjYXF6Y2hiem16Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUwMTYxMTMsImV4cCI6MjExMDU5MjExM30.LjKnwQmjnIXKGMkHXA9vqhIH4sMt4Y6n6FIeIJ7-2qA',

  // 지도 제공자: 'kakao' (국내). 나중에 해외용 provider를 추가하면 여기서 바꿉니다.
  MAP_PROVIDER: 'kakao',

  // 처음 지도 중심 (기본: 부산 광안리)
  DEFAULT_CENTER: { lat: 35.1532, lng: 129.1186 },
};
