# 팀 제공 자료 인덱스

`research/korean-equity-rwa/sources/user/`는 팀원이 제공한 변경 금지 원본 영역이다. 아래 체크섬은 2026-08-22 기준 SHA-256이며, 이 문서는 원본의 위치와 설계 반영 여부를 감사할 수 있게 한다. 팀 문서는 유용한 선행조사이지만 공식 법령·감독자료·표준과 충돌할 경우 후자를 우선한다.

| ID | 원본 경로 | SHA-256 | 사용 판단 |
|---|---|---|---|
| U001 | `research/korean-equity-rwa/sources/user/한국주식RWA_규제부터거래까지_워크스루.html` | `639e70519a145707a8423733179c6513240bdc70a5735fe0d9f8d034d0f14ee4` | 발표 흐름·사용자 여정 참고. 근거자료로 인용하지 않음 |
| U002 | `research/korean-equity-rwa/sources/user/2kqaugmsmwbn3a.png` | `bd6bfe1af061c65b42231e645f08cf4767fb8a8cb0f44ad02581cd2d20755486` | SEC 토큰화 증권 분류의 조사 단서. SEC 원문으로 재검증 |
| U003 | `research/korean-equity-rwa/sources/user/경서님/W1_국내_자본시장법_및_토큰증권_규제_현황.pdf` | `8dd8c35620698999df17676d8a958dd0b67712825d65751476f3ea521c583398` | 규제 연혁과 2단계 구상 참고. 시행일·적용대상은 법령/FSC 재검증 |
| U004 | `research/korean-equity-rwa/sources/user/경서님/W2_vasp_지급결제_투자자식별모델구조화.pdf` | `17450b72d6ba70facd7c860204678bf40f0c87a5d8f740bc157f965b4838e44b` | 지급결제·VASP 쟁점 참고. USDC·CCIP는 코어에서 제외 |
| U005 | `research/korean-equity-rwa/sources/user/경서님/W3_명의개서대리인구조_프라이버시적용가능성_온체인연동한계.pdf` | `d24dbfb608408aa7a4664f3364a8b75d8fa42c325efc5a890990ce9b2d7be981` | 기업행동·T+2 상태 모델 참고. 1단계 토큰 보유자와 직접 주주를 구분하도록 수정 |
| U006 | `research/korean-equity-rwa/sources/user/경서님/W5_Compliance_Rule_Engine_설계.pdf` | `64455eb12bd3966475e0e9233540d94f741931eb11a4b218afa841145908504e` | 규칙 엔진 출발점. 외국인 총량 검사를 모든 외국인 간 이전에 적용하는 부분은 수정 |
| U007 | `research/korean-equity-rwa/sources/user/경서님/W6_신원증명_전송제한_프라이버시_결합방안.pdf` | `5f2a18bd6310a7b36ebc45586874c1ab7aa4fa49c336a83e1444cc9980b95728` | PII 오프체인·결과 온체인 원칙 반영 |
| U008 | `research/korean-equity-rwa/sources/user/경서님/W7_투자자식별데이터_온체인상태_결합시나리오.pdf` | `91c375998bfe144ed4d9df41bbf095f2f259251c864546ddb94f6addb5616d7d` | 정상·거절 시나리오 참고. 명의개서 화이트리스트 표현은 권리원장 적격성으로 수정 |
| U009 | `research/korean-equity-rwa/sources/user/민겸님/VerifyVasp.pdf` | `68cd09db7aaf306560eb5fa92200dfd19c3b8db922d62afefe0be8f7a4c66494` | VASP·트래블룰 판단 참고. 특정 벤더는 코어 의존성에서 제외 |
| U010 | `research/korean-equity-rwa/sources/user/휘서님/W1_블록체인_아키텍처_비교분석.pdf` | `2c28bf2a6aaf4ee1a9a904c0a5db912c379f1a32ec816d03473952d0ee236cbd` | Besu 단일 구현 권고 반영 |
| U011 | `research/korean-equity-rwa/sources/user/휘서님/W2_블록체인_인터오퍼러빌리티_리서치보고서.pdf` | `ad10790a61a8fdfc9c73d0ce8bc4897b84b66e47dd934393ffc8d4b571eac035` | 상호운용 위험과 mock 구분 참고. 임의 Besu를 CCIP 운영망으로 간주하지 않음 |
| U012 | `research/korean-equity-rwa/sources/user/휘서님/W3_한국주식RWA_로컬노드_데이터연동_아키텍처.pdf` | `929ff39dc31789d00daefdf4f51298fae476cf4b4f67e712eda80d891bec059f` | 어댑터 아이디어 참고. 퍼블릭 USDC→Besu 결제 구조는 제외 |
| U013 | `research/korean-equity-rwa/sources/user/휘서님/W4_오라클환경_실물자산_온체인동기화.pdf` | `17725545a17f2dd7ba99552a3d0fb0b3f7637bf6830415785e4d234b9a04d2c7` | 데이터 신선도·오라클 실패모드 반영. 벤더 비교 주장은 재사용하지 않음 |
| U014 | `research/korean-equity-rwa/sources/user/Dinari와 토큰화 주식.pdf` | `fe209321a0dfeea35c3b3dbbd0e1dda5ff22f9c59018234c5ef18b8f7d2a30ae` | Dinari 수탁형 구조의 조사 단서. ChatGPT 대화 출력물이므로 직접 근거로 인용하지 않고 SEC·FINRA·Dinari 공식 자료로 재검증 |
| U015 | `research/korean-equity-rwa/sources/user/1b30ec6e-7c96-4323-ab23-cfdfd85071b7_주식_RWA를_통한_외국인_투자자의_한국_주식_접근성_개선.pdf` | `74748c2c19c35769b8a899bc6861f8ba15a2317c9fd510fd6bfbf2764f6ff95b` | 현행 전자등록체계, 간접 수탁 토큰화와 2027년 법정 분산원장 계좌부를 연결한 설계 기준. 법률 서술은 전자증권법·상법·금융위 원문으로 재검증 |

## 주요 충돌 판정

1. **이중 원장 대 단일 원장**: 자산 OP Stack·현금 Besu·CCIP 연결안보다, PoC에서 DvP 불변식을 실제 검증할 수 있는 단일 허가형 원장을 채택한다.
2. **전자등록주식 대 수탁 권리**: 1단계는 법적 주식 자체가 아닌 계약상·수익적 권리다. 2단계에서만 전자등록기관, 계좌관리기관 또는 등록된 발행인계좌관리기관이 참여하는 법적 증권 계좌부를 전제한다.
3. **즉시 체결 표현**: KRX 기초주식 매입은 시장시간과 외부 T+2 결제를 따른다. 즉시성은 결제 완료 재고 위의 제한된 2차 권리 이전에만 적용한다.
4. **외국인 한도**: 외국인 간 권리토큰 이전은 국내 시장의 외국인 총보유량을 증가시키지 않는다. 총량 검사는 기초주식 재고 취득·증가 시점에 수행한다.
5. **개인정보**: 여권번호 원본뿐 아니라 그 해시도 온체인에서 제외한다.
6. **AI 역할**: 자연어 주문의 설명·초안까지만 허용하고 체결 권한과 개인키를 부여하지 않는다.
7. **Dinari 발행시점**: 제공 자료의 체결 후 발행 설명은 공식 제품문서로 확인했으나 최종 증권결제 완료 여부는 확인되지 않았다. 본 PoC는 무담보 발행 위험을 줄이기 위해 KSD 결제·수탁 반영 후 발행을 유지한다.
8. **현행 수탁 권리 대 2027년 법정 장부**: 1단계 토큰은 기초주식의 전자등록계좌부와 별개인 계약상 권리 장부다. 2단계에서는 적격 분산원장이 법정 전자등록계좌부로 기능할 수 있지만, 기존 상장주식의 적용·전환과 거래·청산·결제 인프라는 하위규정과 기관 준비를 조건으로 한다.
9. **최종투자자 직접 기록 대 통합명의 유지**: 2단계 목표는 해외 플랫폼을 접근창구로 두면서 국내 적격 계좌관리기관의 법정 고객계좌부에 최종투자자를 직접 기록하는 구조다. 해외 금융기관 통합명의를 유지하면 분산원장을 사용하더라도 직접 주주 구조가 아니라 기존 통합계좌의 운영개선안으로 평가한다.
