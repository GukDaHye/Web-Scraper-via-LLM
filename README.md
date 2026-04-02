# Web Scraper via LLM 

LLM(Gemini)을 활용하여 웹 페이지의 데이터를 지능적으로 스크래핑하고 구조화하는 크롬 익스텐션(Chrome Extension)입니다. 특히 특정 커머스 사이트의 제품 목록 페이지에서 제품의 상세 스펙을 딥-페치(Deep Fetch)하여 자동으로 추출하고 마크다운 형태로 깔끔하게 정리해 줍니다.

##  주요 기능 (Features)

- **시각적 요소 선택 (Visual Element Picker):** 복잡한 개발자 도구를 열 필요 없이, 화면에서 원하는 리스트, 더보기 버튼, 상세 항목을 클릭만으로 손쉽게 선택할 수 있습니다.
- **자동 페이징 처리 (Auto Load More):** '더보기' 버튼을 자동으로 클릭하여 숨겨진 제품 목록까지 한 번에 로드합니다 (최대 30회).
- **내부 API 딥-페치 (Deep Spec Fetch):** 타겟 커머스 페이지 제품 목록에서 `goodsId`를 추출하여 내부 API를 직접 호출, 상세 페이지에 들어가지 않고도 제품의 세부 스펙(Detailed Specs)을 백그라운드에서 빠르게 긁어옵니다.
- **HTML to Markdown 변환:** 웹 페이지의 지저분한 HTML 요소를 깔끔한 Markdown 형식으로 변환(`Turndown` 라이브러리 활용)하여 가독성을 높입니다.
- **LLM 데이터 정제 (Gemini AI Integration):** 스크래핑된 마크다운 데이터를 백그라운드 스크립트에서 Gemini AI로 전송하여 사용자가 원하는 형태의 JSON이나 구조화된 데이터로 지능적으로 가공합니다.

##  기술 스택 (Tech Stack)

- **언어:** TypeScript, HTML, CSS
- **빌드 도구:** Vite, @crxjs/vite-plugin
- **주요 라이브러리:** Turndown (HTML to Markdown)
- **AI 연동:** Gemini API (예정/연동중)

##  설치 방법 (Installation)

1. 이 저장소를 로컬 컴퓨터로 클론합니다.
   ```bash
   git clone https://github.com/GukDaHye/Web-Scraper-via-LLM.git
   cd Web-Scraper-via-LLM
   ```
2. 필요한 패키지를 설치합니다.
   ```bash
   npm install
   ```
3. 프로젝트를 빌드합니다.
   ```bash
   npm run build
   ```
4. 크롬 브라우저에서 **확장 프로그램 관리(chrome://extensions/)** 페이지를 엽니다.
5. 우측 상단의 **'개발자 모드'**를 켭니다.
6. **'압축해제된 확장 프로그램을 로드합니다'** 버튼을 클릭하고, 프로젝트 내에 생성된 `dist` 폴더를 선택합니다.

##  사용 가이드 (How to Use)

1. 크롬 우측 상단의 익스텐션 아이콘을 클릭하여 팝업 창을 엽니다.
2. 데이터를 추출하고 싶은 웹 페이지(예: 제품 목록 제공 사이트)로 이동합니다.
3. 팝업에서 **'List Element'**, **'Load More (더보기) Button'**, **'Detail Element'**를 각각 클릭하여 화면 상에서 타겟이 될 요소를 지정해 줍니다. (요소 위에 마우스를 올리면 빨간 테두리로 하이라이트 됩니다)
4. 모든 설정이 끝난 후 **'Start Extraction'** 버튼을 누릅니다.
5. 우측 하단에 나타나는 토스트 메시지를 통해 스크래핑 진행 상황(딥-페치, LLM 전송 등)을 실시간으로 확인할 수 있습니다.
6. 완료되면 정제된 데이터를 결과 페이지(Result Page)에서 확인합니다.

---

*본 프로젝트는 LLM 기반의 지능형 데이터 스크래핑을 연구 및 자동화하기 위한 목적으로 제작되었습니다.*
