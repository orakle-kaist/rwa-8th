# 10단계 Fuji 배포와 검증 증거

상태: **Fuji 검증 완료, 10단계 구현 검토 대기**

이 문서는 커밋 `52c47dc3718c6e767311b1298c4c8086bc67c49a`에서 수행한 Avalanche Fuji 시험 결과를 기록한다. 모든 토큰과 자금은 모의 테스트 전용이며 실제 한국주식, 고객 수탁권리나 법적 결제를 뜻하지 않는다.

## 공식 식별정보와 배포주소

- 네트워크: Avalanche Fuji C-Chain, chain ID 43113
- 공식 ISIN 증거 체크섬: `916ef69e08a2d812977777b887f29381b81fb76526e2fc2c77d495d1891e1532`
- 지급자산: Mock USDC, 소수점 6, Circle 발행 아님

| 종목         | KRX 코드 | 공식 ISIN    | Fuji 토큰                                                                                                                           |
| ------------ | -------: | ------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| 삼성전자     |   005930 | KR7005930003 | [0xE615a8c330fEc22f541914D558411362efae139C](https://explorer-test.avax.network/address/0xE615a8c330fEc22f541914D558411362efae139C) |
| SK하이닉스   |   000660 | KR7000660001 | [0xeb26CF2eD01241255477d25bb86Dd0646246D15A](https://explorer-test.avax.network/address/0xeb26CF2eD01241255477d25bb86Dd0646246D15A) |
| SK텔레콤     |   017670 | KR7017670001 | [0xa61629456aAC6Cb14F1A5C32AeDaeee1f9322201](https://explorer-test.avax.network/address/0xa61629456aAC6Cb14F1A5C32AeDaeee1f9322201) |
| 현대차       |   005380 | KR7005380001 | [0xe0E94778965720a042D543196C06852B8CAa7079](https://explorer-test.avax.network/address/0xe0E94778965720a042D543196C06852B8CAa7079) |
| NAVER        |   035420 | KR7035420009 | [0x4E0b0D4afe8f6D6Da2d1F51AE3A73f34fc883F0e](https://explorer-test.avax.network/address/0x4E0b0D4afe8f6D6Da2d1F51AE3A73f34fc883F0e) |
| 미래에셋증권 |   006800 | KR7006800007 | [0xB3B2aF898Eb59428233dedfeCe8625Dfdfb6ba41](https://explorer-test.avax.network/address/0xB3B2aF898Eb59428233dedfeCe8625Dfdfb6ba41) |

## 시험 결과

- `Fuji-배포-01`: 통과
- `Fuji-직접이전차단-01`: 통과
- `Fuji-생애주기-01`: 통과

삼성전자 모의 토큰 1주를 결제 대기로 발행하고 결제와 수탁 확인 뒤 거래 가능으로 전환했다. 투자자와 지정 시장조성자 사이에서 6자리 Mock USDC DvP를 수행한 뒤 시장조성자의 권리를 환매 잠금, 지급청구, 소각 대기와 소각으로 종료해 마지막 공급량을 0으로 확인했다.

## 거래 증거

| 단계                      |     블록 | Fuji 거래                                                                                                                                                                      |
| ------------------------- | -------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 발행 체결·배분 확인       | 58110547 | [0xec6c2c35cacaa160228852f97699c1be03f8736c2d669d86350b879dcd3a6a18](https://explorer-test.avax.network/tx/0xec6c2c35cacaa160228852f97699c1be03f8736c2d669d86350b879dcd3a6a18) |
| T+2 위험 승인             | 58110548 | [0xf1fe0e1d3ced00c0bf248b19342831d6a89ecae599f0016e3cbb4278c59a59d3](https://explorer-test.avax.network/tx/0xf1fe0e1d3ced00c0bf248b19342831d6a89ecae599f0016e3cbb4278c59a59d3) |
| 권리기입 승인             | 58110552 | [0xb7fe8cea9e00bb085c651ffc8c4ee9f75ace53a269ba657b794a8ec85e21fa11](https://explorer-test.avax.network/tx/0xb7fe8cea9e00bb085c651ffc8c4ee9f75ace53a269ba657b794a8ec85e21fa11) |
| 권리원장 반영 확인        | 58110553 | [0x8aad0c0de6780ade27c90976defe5b9e4435102fc2947324ec888252a7d22fd8](https://explorer-test.avax.network/tx/0x8aad0c0de6780ade27c90976defe5b9e4435102fc2947324ec888252a7d22fd8) |
| 결제대기 발행             | 58110554 | [0x55234a46d26e2a0777fd491d3ac51d8a6cebe95f659ec00ac6479a28663bf3e0](https://explorer-test.avax.network/tx/0x55234a46d26e2a0777fd491d3ac51d8a6cebe95f659ec00ac6479a28663bf3e0) |
| 국내 결제 확인            | 58110558 | [0x628f7750a37858f9599eb2046bc7842b81d4c7243d45269e3547f10d0142d4a3](https://explorer-test.avax.network/tx/0x628f7750a37858f9599eb2046bc7842b81d4c7243d45269e3547f10d0142d4a3) |
| 수탁수량 확인             | 58110560 | [0x445971723d02097c84f07b95e379032821f67a80f01430fdf678e8dcb65bb4ff](https://explorer-test.avax.network/tx/0x445971723d02097c84f07b95e379032821f67a80f01430fdf678e8dcb65bb4ff) |
| 거래 가능 전환            | 58110561 | [0x2836abf8303c196deec7e58b4a716ea77e1224134c1e55a51bf7e8051b8fdfc8](https://explorer-test.avax.network/tx/0x2836abf8303c196deec7e58b4a716ea77e1224134c1e55a51bf7e8051b8fdfc8) |
| 시장조성자 Mock USDC 지급 | 58110562 | [0xe4a9aff2fb9cfe7818808374695255fa79e2043e0a57130eee3baa4ece0cd1e7](https://explorer-test.avax.network/tx/0xe4a9aff2fb9cfe7818808374695255fa79e2043e0a57130eee3baa4ece0cd1e7) |
| 시장조성자 Mock USDC 승인 | 58110564 | [0xd3f3e2d1bd5438855faa844f9d05c141ed1430a28960e752d0837923c4c6afc0](https://explorer-test.avax.network/tx/0xd3f3e2d1bd5438855faa844f9d05c141ed1430a28960e752d0837923c4c6afc0) |
| Mock USDC DvP             | 58110565 | [0x53a080029defa39df8626fcd4c412532f143ab0dcc91bf119c6bc96996dfc961](https://explorer-test.avax.network/tx/0x53a080029defa39df8626fcd4c412532f143ab0dcc91bf119c6bc96996dfc961) |
| 환매 잠금                 | 58110566 | [0x73c2f4b61794aed5b1860c467aa5a0871fd38ff822a909fa8eda80fd92f82f3b](https://explorer-test.avax.network/tx/0x73c2f4b61794aed5b1860c467aa5a0871fd38ff822a909fa8eda80fd92f82f3b) |
| 국내 매도 제출            | 58110567 | [0x370516578cc8b3b8717a15511a88739995b673ae9a154206c188a55efc4cda28](https://explorer-test.avax.network/tx/0x370516578cc8b3b8717a15511a88739995b673ae9a154206c188a55efc4cda28) |
| 국내 매도 체결            | 58110570 | [0x2c06710b182d1bf99ec0d218dbdff858bac68eebad5c1de4449804bc94728b64](https://explorer-test.avax.network/tx/0x2c06710b182d1bf99ec0d218dbdff858bac68eebad5c1de4449804bc94728b64) |
| 매도대금 결제             | 58110571 | [0x248ac4d1441211f84b34c41c4e1467f7099d6478921d3be1fea1b21d0bb14dee](https://explorer-test.avax.network/tx/0x248ac4d1441211f84b34c41c4e1467f7099d6478921d3be1fea1b21d0bb14dee) |
| 권리 종료                 | 58110573 | [0x06348d08227621361a88856418a67675b8510b2bac220331eec737ac75e16e62](https://explorer-test.avax.network/tx/0x06348d08227621361a88856418a67675b8510b2bac220331eec737ac75e16e62) |
| USD 지급청구              | 58110574 | [0xf5a181537ff2b41ca9d3e689d96fbebcdc0dc8ff0fecb601cd16e3dcd7f9517a](https://explorer-test.avax.network/tx/0xf5a181537ff2b41ca9d3e689d96fbebcdc0dc8ff0fecb601cd16e3dcd7f9517a) |
| 소각 대기                 | 58110575 | [0x1cfa3aed2266864b7d41e0fdf24b7c60a7310c59db01f241250902ad6adc1515](https://explorer-test.avax.network/tx/0x1cfa3aed2266864b7d41e0fdf24b7c60a7310c59db01f241250902ad6adc1515) |
| USD 지급 승인             | 58110576 | [0xa8aeffc50ebe97dbd45ac4e2ccdd4f1b1d23f07203d9b9e7e0025229ca53b437](https://explorer-test.avax.network/tx/0xa8aeffc50ebe97dbd45ac4e2ccdd4f1b1d23f07203d9b9e7e0025229ca53b437) |
| 환매 소각                 | 58110577 | [0x0cd25fe7a99d02a243d41de4ea515ecc54f2f7667f92a1af1c3ca59afe2e6b14](https://explorer-test.avax.network/tx/0x0cd25fe7a99d02a243d41de4ea515ecc54f2f7667f92a1af1c3ca59afe2e6b14) |

## 해석 경계

Fuji 온체인 통제와 모의 기관 증거 연결만 검증하며 고객 권리 원장 또는 법적 결제 완료를 뜻하지 않는다. 공개 테스트넷의 성공은 실제 유동성, 가격 공정성, 규제 허용, 기관 계약이나 상용 보안을 입증하지 않는다. 개인키, 공공데이터 인증키, 전체 인증토큰과 전체 서명은 증거에 저장하지 않았다.
