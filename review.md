# Review Notes — zod-contract-mock-forge-mcp v0.2.0

Overall: ship-ready. Все 10 инструментов работают через stdio, версии синхронизированы, пакет чистый.

## 1. dist/index.test.js попадал в npm пакет (исправлено)

Тестовый файл `src/index.test.ts` компилировался в `dist/` и публиковался с пакетом.
Исправление: добавлен `"exclude": ["src/**/*.test.ts"]` в `tsconfig.json`.
Побочный эффект: `@typescript-eslint/parser` перестал находить тест-файл в tsconfig-проекте → lint ошибка в CI.
Второе исправление: создан `tsconfig.eslint.json` (extends tsconfig, exclude: []) и eslint.config.mjs обновлён.

## 2. server.json отсутствовал в npm пакете (исправлено)

Файл существовал, но не был указан в `files` в package.json.
Исправление: добавлен `"server.json"` в массив `files`.

## 3. server.json и serverInfo версии устарели (исправлено)

`server.json` оставался на `0.1.0`. `serverInfo.version` в `src/index.ts` тоже `0.1.0`.
Исправлено вместе с bumping package.json до `0.2.0`.

## 4. README не содержал v2 инструменты (исправлено)

Описывал только 6 оригинальных инструментов, ссылался на сборку из исходников.
Исправление: полная таблица из 10 инструментов, npm install, MCP config, примеры вывода.

## Результаты проверки

- `npm run build` — чисто
- `npm test` — 33/33 passing
- `npm run lint` — только warnings (any в тестах), 0 errors
- `npm run format:check` — чисто
- `npm pack --dry-run` — `dist/index.js`, `dist/index.d.ts`, `README.md`, `LICENSE`, `server.json` (тест-файлы отсутствуют)
- `git remote -v` — SSH remote подтверждён
- version sync: package.json=0.2.0, serverInfo=0.2.0, server.json=0.2.0/0.2.0
- `tools/list` — все 10 инструментов зарегистрированы
- `tools/call` через stdio для всех 4 новых v2 инструментов — без ошибок
- тег v0.2.0 запушен, CI publish запущен
