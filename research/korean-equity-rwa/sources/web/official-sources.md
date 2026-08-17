# 공식·기술 원문 소스 노트

검증 기준일은 2026-08-17이다. `A`는 법령·감독기관·공식 표준·직접 감사 가능한 1차 자료, `B`는 공식 기관의 설명 또는 기업 약관이다. 아래 요약은 원문의 대체물이 아니며 실제 사업화 시 최신 원문과 법률의견을 다시 확인해야 한다.

| ID | 등급 | 출처 | 확인된 범위 | 설계 사용 |
|---|---:|---|---|---|
| S001 | A | [금융위원회, 외국인 통합계좌 이용 가이드라인 발표](https://www.fsc.go.kr/no010101/85748) | 외국인이 별도 국내 계좌 없이 해외 금융투자업자 명의 통합계좌로 주문·결제할 수 있음. 2025년 8월 하나증권–Emperor 계좌 개설 | 문제를 접근 불가가 아닌 잔존 운영 마찰로 재정의 |
| S002 | A | [금융위원회, 외국인 통합계좌 운영 설명](https://www.fsc.go.kr/no010102/86339) | 2025년 10월 최초 투자 개시, 2026년 1월 개설주체 제한 폐지, 해외 증권사의 고객·주문 취합 역할 | 홍콩을 첫 실재 참조 경로로 선택하되 코어에 하드코딩하지 않음 |
| S003 | A | [국가법령정보센터, 개정 전자증권법](https://law.go.kr/LSW/lsInfoP.do?lsiSeq=283195&viewCls=lsRvsDocInfoR) | 2026년 2월 3일 공포, 공포 후 1년 시행; 분산원장과 관련 계좌관리 법적 기반 | 2단계 로드맵의 법적 출발점 |
| S004 | A | [금융위원회, 토큰증권 법률 개정안 통과 설명](https://www.fsc.go.kr/po010105/86064) | 분산원장을 증권 계좌부로 이용할 수 있으나 자본시장법상 증권 규제가 그대로 적용됨 | 기술표준이 인허가·공시·중개규제를 대체하지 않는다는 경계 |
| S005 | A | [금융위원회, 토큰증권 협의체 제2차 회의](https://www.fsc.go.kr/no010101/86906) | 시행일 2027-02-04 예정. 기존 주식·채권·MMF의 토큰화는 테스트와 인프라 개선을 단계적으로 준비 | 개정법만으로 상장주식 토큰화가 즉시 상용화된다고 주장하지 않음 |
| S006 | A | [한국은행, Project Hangang 1단계 보고서](https://www.bok.or.kr/eng/bbs/E0000654/view.do?menuNo=400048&nttId=10095216) | 허가형 통합원장, Hyperledger Besu, QBFT, 토큰화 예금 구조의 실제 파일럿 | 단일 허가형 원장과 모의 원화 예금토큰의 참조 근거 |
| S007 | A | [금융위원회, Project Hangang 2단계 지정](https://www.fsc.go.kr/no010101/87338) | 2026년 7월 15일, 하나은행 포함 7개 은행, 이용자·사용처 확대 및 송금 추가 | 은행 결제 역할의 현실성 근거. 본 PoC와 직접 연동을 의미하지 않음 |
| S008 | B | [하나은행, 예금토큰 서비스 이용약관](https://www.kebhana.com/cont/customer/customer07/customer0702/customer070209/1507311_115365.jsp) | 2025년 4월 1일 시행 약관의 존재 | 기관별 실증 경험의 참고. 특정 은행 종속성은 만들지 않음 |
| S009 | A | [홍콩 SFC, Tokenised Securities 관련 Circular](https://apps.sfc.hk/edistributionWeb/api/circular/openFile?lang=EN&refNo=23EC52) | 소유권 기록, 기술위험, 결제 완결성, 이전제한, 키 관리, BCP, 감사, 수탁 공시 통제 | `HKDistributionPolicy`와 통제 체크리스트의 참조 |
| S010 | A | [미국 SEC Corporation Finance, Tokenized Securities Statement](https://www.sec.gov/newsroom/speeches-statements/corp-fin-statement-tokenized-securities-012826-statement-tokenized-securities) | 발행인 주도형과 제3자 주도형, 제3자 수탁형 권리와 합성형 노출의 구분 | 1단계 권리를 직접 주식이나 합성형 가격노출과 구분 |
| S011 | A | [ERC-3643](https://eips.ethereum.org/EIPS/eip-3643), [ERC-7943](https://eips.ethereum.org/EIPS/eip-7943), [ERC-7540](https://eips.ethereum.org/EIPS/eip-7540) | 세 표준 모두 Final. ERC-3643은 적격성·통제, ERC-7943은 최소 RWA 통제 인터페이스, ERC-7540은 비동기 ERC-4626 요청 | 전송통제·상태모델 참조. ERC-7540을 일반 주식거래 전체에 적용하지 않음 |
| S012 | A | [Hyperledger Besu changelog](https://github.com/besu-eth/besu/blob/main/CHANGELOG.md) | Tessera·사설거래 기능 sunset/removal 이력 | Tessera 프라이버시를 전제하지 않고 데이터 최소화·오프체인 분리를 사용 |
| S013 | A | [BIS Innovation Hub, Project Agorá](https://www.bis.org/about/bisih/topics/fmis/agora.htm) | 토큰화된 상업은행 예금·중앙은행 화폐를 공유 프로그래머블 플랫폼에서 시험 | 장기 결제 구조 비교 사례. 현재 PoC의 구현 의존성은 아님 |
| S014 | A | [국가법령정보센터, 전기통신사업법 제8조](https://www.law.go.kr/법령/전기통신사업법/제8조) | 일정 기간통신사업자의 외국정부·외국인 합산 주식소유를 발행주식 총수의 49%로 제한 | KT 실패 시나리오의 법적 배경. 실제 종목별 room은 모의 데이터 사용 |
| S015 | A | [SEC EDGAR, Dinari Inc. 2025 Form TA-2](https://www.sec.gov/Archives/edgar/data/1915430/000191543025000002/0001915430-25-000002-index.html) | Dinari Inc.가 2025년 4월 SEC를 감독기관으로 기재한 이전대리인 연차공시를 제출했음 | 이전대리인 등록사실 확인. dShares 또는 개별 상품에 대한 SEC 승인의 근거로 사용하지 않음 |
| S016 | A | [FINRA BrokerCheck, Dinari Securities LLC](https://files.brokercheck.finra.org/firm/firm_329672.pdf) | CRD 329672, SEC·FINRA 등록, Alpaca Securities에 고객을 소개하고 청산·수탁 서비스를 이용하는 구조 | 브로커와 청산·수탁 역할을 분리해 설명 |
| S017 | B | [Dinari, dShares 상품 설명](https://dinari.com/dshares) | 기초주식 1:1 수탁, Dinari Securities의 매입, Alpaca 수탁, 적격 지갑 발행, 배당·분할·환매에 관한 회사 설명 | 대표 수탁형 사례의 수명주기와 권리·중개사슬 비교 |
| S018 | B | [Dinari Docs, What are dShares?](https://docs.dinari.com/docs/what-is-dshare) | 브로커 주문 체결 완료 통지 후 발행하고, 환매 주문 체결 후 소각·지급하는 공개 흐름 | 체결 후 발행과 최종 증권결제 후 발행의 위험·속도 차이 분석 |
| S019 | B | [Dinari Docs, Restrictions](https://docs.dinari.com/docs/restrictions) | Regulation S, 미국인·제한관할 및 비적법 이전에 관한 제한 | 토큰 보유·이전 가능성이 판매관할과 적격성에 종속됨을 설명 |
| S020 | B | [Dinari Docs, Dividends](https://docs.dinari.com/docs/dividends) | 지정 시점 보유, 등록 계정·지갑, 유효한 KYC와 최소 지급액 등 배당 자격요건 | 토큰 잔액과 권리행사 자격을 구분하고 기업행동 통제를 설계 |
| S021 | B | [Dinari Docs, Stock Splits](https://docs.dinari.com/docs/stock-splits) | 거래중지, 주문취소, 토큰 수량조정, 기초주식 반영 검증 후 재개하는 회사 절차 | 주식분할을 후속 기업행동 범위로 두되 필요한 통제 순서를 설명 |
| S022 | B | [Dinari, SEC Crypto Task Force 제출서](https://www.sec.gov/files/ctf-written-input-dinari-inc-040226.pdf) | 2026년 4월 미국용 제안은 브로커의 오프체인 장부를 권위기록으로 두고 토큰을 이전불가·독립권리 없는 보조기록으로 설명 | 국제 dShares 수탁권리 모델과 미국 보조기록 제안을 구분하고 관할·상품별 권리정의 필요성을 설명 |
| S023 | A | [금융위원회, 외국인 투자자의 국내 투자 접근성 제고](https://fsc.go.kr/po010106/81234) | 2023년 12월 14일부터 외국인 사전등록을 폐지하고 법인은 LEI, 개인은 여권번호로 국내 상장증권 계좌를 관리. 통합계좌 보고와 장외거래도 별도 개선 | 직접계좌와 통합계좌가 서로 다른 현행 접근경로임을 구분 |
| S024 | A | [금융위원회, 외국인 투자자 등록제 폐지 이후 계좌개설 실적](https://www.fsc.go.kr/po010107/82508) | 2023년 12월 15일부터 2024년 6월 12일까지 LEI·여권번호 기반 계좌 1,432개 개설. 법인서류와 위임장 확인관행의 후속 개선도 설명 | 직접계좌가 명목상 제도가 아니라 실제 이용되는 기준선임을 확인 |
| S025 | A | [한국예탁결제원, 해외 DR 원주관리 서비스](https://www.ksd.or.kr/ko/api/download/static?fileNm=%ED%95%B4%EC%99%B8DR%EC%9B%90%EC%A3%BC%EA%B4%80%EB%A6%AC%EC%84%9C%EB%B9%84%EC%8A%A4_FN.pdf) | 국내 원주를 원주관리기관에 보관하고 해외 예탁기관이 ADR·GDR을 발행하며 원주 전환과 기업행동을 처리하는 구조 | 해외 DR을 기존 접근수단이자 수탁 권리 토큰의 기능적 비교대상으로 추가 |
| S026 | A | [한국거래소, ETF의 상품 성격과 거래](https://global.krx.co.kr/contents/GLB/06/0605/0605010103/GLB0605010103.jsp) | ETF는 주식처럼 거래되더라도 개별 주식이 아니라 지수를 추종하는 펀드라는 상품 경계 | 한국주식 직접 보유와 ETF·펀드 간접노출을 구분 |

## 소스별 해석 제한

- S001·S002는 통합계좌가 모든 국가·모든 투자자에게 즉시 개방됐다는 뜻이 아니다. 해외 판매기관 참여, 시스템 연동, 고객확인 및 권리배정은 계속 필요하다.
- S003~S005는 분산원장 기록에 법적 효력이 생길 경로를 보여주지만, 현재 1단계 수탁 권리 토큰이 상장주식 자체라는 결론을 지지하지 않는다.
- S006~S008은 예금토큰 기술과 기관 경험의 참조다. 외국인 개인이 한국 예금토큰을 직접 보유할 수 있다는 근거로 사용하지 않는다.
- S009의 홍콩 통제는 참조 프로파일에만 적용한다. 한국 코어 계약이나 다른 관할의 법적 의무로 일반화하지 않는다.
- S011의 표준 준수는 증권법 준수를 의미하지 않는다. 특히 ERC-3643의 agent mint·forced transfer 기능에는 별도의 기관 승인과 준비금 게이트가 필요하다.
- S014의 49%는 법률상 일반 범주 설명이다. PoC의 잔여수량과 시세는 전부 합성 fixture이며 실제 투자 판단에 사용할 수 없다.
- S015·S016의 기관 등록은 dShares 상품이나 특정 판매방식에 대한 SEC·FINRA의 승인을 뜻하지 않는다.
- S017~S021은 Dinari가 제공한 제품 설명과 운영문서다. 1:1 수탁, 독립 감사, 권리와 운영범위는 회사 주장으로 표시하고 실제 계약·계좌·감사보고서 실사 없이 법적 안전성을 단정하지 않는다.
- S018은 주문 체결 완료 후 발행을 설명하지만 최종 증권결제 시점, 사전재고 또는 결제실패 위험부담 주체까지 공개하지 않는다. 본 제안의 결제 완료 후 발행은 이 공백에 대한 보수적 설계 선택이다.
- S022는 Dinari가 SEC에 제출한 설명·확인요청이며 SEC의 동의, 무조치의견 또는 승인이 아니다. 국제 dShares의 이전 가능한 수탁권리 구조와 같은 상품이라고 일반화하지 않는다.
- S023·S024는 외국인 직접계좌 경로가 실제 존재한다는 근거다. 사전등록 폐지가 투자자별 고객확인, 계좌, 외환, 수탁, 세무와 권리업무까지 없앴다는 뜻으로 확대하지 않는다.
- S024의 1,432개는 2023년 12월 15일부터 2024년 6월 12일까지의 역사적 실적이며 현재 누적계좌 수로 사용하지 않는다.
- S025의 상품 구조는 해외 DR 비교에 사용하되, 안내서에 수록된 2019년 말 종목 수와 종목 목록을 현재 현황으로 사용하지 않는다. 수탁 권리 토큰이 법률상 DR에 해당하거나 해당하지 않는다는 결론도 이 자료만으로 내리지 않는다.
- S026은 ETF가 개별 주식이 아닌 펀드라는 상품 경계의 근거다. 특정 해외시장에서 모든 외국인이 한국지수 ETF를 이용할 수 있다는 근거로 사용하지 않는다.
