# Korean Equity RWA Institutional PoC

Dinari의 수탁형 토큰화 주식 사례를 출발점으로, 외국인이 한국 상장주식에 접근할 때 필요한 계좌·주문·T+2 결제·수탁·권리배정·보고 구조를 한국 시장과 국내 규제 맥락에 맞게 다시 설계하는 기관 제안형 프로젝트입니다.

현재는 **마스터 제안서 검토 단계**입니다. PoC 코드, PRD, 화면·API·상태기계·스마트컨트랙트 명세는 아직 확정하지 않았으며 실제 자금·증권·개인정보를 취급하지 않습니다. 이 저장소의 내용은 학술 프로젝트의 설계 가설로서 법률의견, 인허가 판단 또는 기관의 승인을 대체하지 않습니다.

## 현재 기준 문서

[final_candidate.md](research/korean-equity-rwa/drafts/final_candidate.md)가 현재 단계의 **유일한 마스터 설계 후보이자 판단 기준**입니다. 아래 문서는 후보를 이해하고 검토하기 위한 보조자료이며, 마스터의 결정을 덮어쓰지 않습니다.

- [리서치 브리프](research/korean-equity-rwa/brief.md): 질문, 범위와 성공 기준
- [공식 출처 정리](research/korean-equity-rwa/sources/web/official-sources.md): 공개 근거와 확인 기준일
- [팀 제공 자료 인덱스](research/korean-equity-rwa/sources/notes/user-material-index.md): 원자료 위치, 체크섬과 반영 판단
- [내부 인간 검토 메모](research/korean-equity-rwa/review/human_review.md): 승인 전 판단할 쟁점과 알려진 한계

`_work/`는 조사 과정과 검증 이력을 보존하는 내부 작업 기록입니다. 과거에 먼저 작성했던 상세 설계와 기계 판독 명세는 [pre-PRD v1 아카이브](archive/pre-prd-v1/README.md)에 동결했습니다. 해당 아카이브는 참고자료일 뿐 현재 또는 향후 구현의 규범적 기준이 아닙니다.

## 한 문장 구조

해외 판매기관이 확인한 투자자와 권리계정·지갑을 국내 외국인 통합계좌 및 수탁 구조에 연결하고, 한국시장의 T+2 결제와 수탁 반영이 확인된 수량 범위 안에서만 `1 token = 1 share entitlement` 권리를 발행한 뒤 국내 수탁장부, 해외 투자자 권리장부와 허가형 토큰 기록을 지속 대사합니다.

PoC는 같은 거래를 투자자 거래 화면, 토큰화 운영 화면, 국내 브로커·수탁 인프라 화면에서 각자의 책임과 증거에 맞게 보여주는 것을 목표로 합니다. 공개자료로 확인되는 Dinari·Alpaca의 계좌·주문·활동 개념을 참고하되, 비공개 내부 화면이나 실제 업체 연동을 재현한다고 주장하지 않습니다.

## 저장소 구조

```text
research/korean-equity-rwa/
  brief.md                  조사 질문·범위·성공 기준
  drafts/final_candidate.md 현재 단계의 유일한 마스터 후보
  sources/                  공식 출처, 팀 제공 원자료와 인덱스
  review/human_review.md    내부 검토 쟁점과 한계
  _work/                    조사·검증 이력
archive/pre-prd-v1/         확정 전 작성된 과거 설계·명세의 비규범 스냅샷
scripts/                    현재 단계의 저장소·리서치 검증기
PROJECT_WORKFLOW.md         승인 이후를 포함한 단계별 산출물·검토 게이트
```

PRD와 후속 산출물 폴더는 마스터가 승인된 뒤 해당 단계가 시작될 때 생성합니다. 산출물 순서와 각 단계의 완료 조건은 [프로젝트 워크플로](PROJECT_WORKFLOW.md)를 따릅니다.

## 현재 상태

- 단계: `master review`
- 리서치 사실 검증 기준일: `2026-08-17 Asia/Seoul`
- PoC 구현: 미착수
- 마스터 승인: 내부 인간 검토 대기
- 외부 기관 검증: 수행하지 않음

팀원은 증권사·수탁기관·은행·해외 판매기관·규제·감사·투자자 역할을 번갈아 맡아 **기관 관점의 가설을 내부 검토**합니다. 이 활동은 실제 기관의 검토나 제도적 타당성 확인으로 표현하지 않습니다.

## 검증

현재 활성 문서의 구조, 링크, JSON·JSONL·YAML, 팀 제공 원자료 체크섬과 RWA 리서치 후보 게이트는 다음 명령으로 검사합니다.

```bash
bash scripts/validate-research.sh
```
