# Хелперы, модерация и админка — карта, состояние, бэклог

> Живой документ. Составлен 2026-10-26 по коду `main` + live-проверке прод-сервера BIA.
> Дополняет: `ADMIN`-часть [ROADMAP.md](./ROADMAP.md) (P1, v1.0), [MAINPLAN.md](../../MAINPLAN.md) Track A,
> [ADR-0010](./adr/0010-helper-role.md), [ADR-0008](./adr/0008-private-support-clouds.md), ADR-0011 (приватные уведомления).
> Прод-доступы и топология — `SERVER_MAP.md` (локальный, в git не хранится).

---

## 0. TL;DR

| Что | Состояние 2026-10-26 |
|---|---|
| ИИ-чат на проде | **Включён.** `AI_API_KEY` добавлен в `/etc/depress/depress.env`, `depress-api` перезапущен, живой ответ 200 за ~3 с, `offline=false` |
| Хелперы в коде | Готово: роль, смена (duty), heartbeat, мгновенный мэтч, живая очередь по WS, инвайты, дашборд, модерация облаков |
| Хелперы на проде | Роль выдана аккаунту владельца (2026-10-26), смена включается тумблером в `/helper`. Инвайты — 0 |
| Модерационное окно | `/helper`: Queue / Clouds / Summary. Мёртвая вкладка **Requests удалена** (2026-10-26) |
| Админка `/console/` | Overview / Reports / **Clouds** / **Helpers** / Log, пагинация, ссылка на вход. Нет: терапии и правки тихих фраз |
| Данные на проде | 1 аккаунт (staff/owner), 0 репортов, 0 pending-облаков, 0 терапевтов, 55 опубликованных историй / 75 записей всего |

Три вещи, которые дают максимум эффекта за минимум работы:
1. завести хелпера и включить ему смену (иначе Help = AI / «никого нет»);
2. починить консоль: инвалидация кэша после решения + не вызывать `onError` в рендере;
3. убрать/оживить мёртвую вкладку Requests, чтобы хелперов не вводили в заблуждение.

### Что закрыто в P0 (2026-10-26)

Все 16 дефектов из §7 исправлены в одном батче:

| # | Было | Стало |
|---|---|---|
| B1 | мёртвая вкладка Requests | вкладка, 3 эндпоинта, сервисы и клиентские методы удалены |
| B2 | Django-admin actions мимо сервисов | actions вызывают `approve_cloud`/`reject_cloud` |
| B3 | облака без аудита | `ModerationAction.cloud` + `cloud_approved`/`cloud_rejected` (миграция 0007) |
| B4 | Helper скрыт у staff | вкладка видна при `is_helper` **или** `is_staff` |
| B5 | репорт всегда `other` | лист с 4 причинами + поле деталей (история); в чате пока `abuse` |
| B6 | mini без живой очереди | вкладка Queue по WS (тот же хук, что в браузере) |
| B7 | консоль без входа | кнопка на `/admin/login/?next=/console/` |
| B8 | после решения устаревали счётчики | инвалидация `admin-overview` и `admin-log` |
| B9 | `onError` в рендере | перенесён в `useEffect` (+ `useCallback` в App) |
| B10 | нет пагинации | `offset` на бэке, «Показать ещё» в Reports и Log |
| B11 | сырые статусы в UI | статус убран из карточки, причина переведена |
| B12 | в консоли не видно очередь | счётчики «ждут человека» и «хелперы на смене» |
| B13 | recent_reports со всеми статусами | только `open`/`reviewing` |
| B14 | хелперу уходил `HELP_ACCEPTED` | уходит `HELP_REQUESTED`, `HELP_ACCEPTED` — только автору заявки |
| B15 | инвайты не отозвать | `DELETE /helper-invites/{token}` + выбор TTL 24ч/7д/30д |
| B16 | решение без подтверждения | «Решение сохранено» / «Очередь обновлена» / «Смена обновлена» |

Побочно закрыто: `is_stub_translation` теперь узнаёт и старый локализованный маркер `[офлайн …]`
(из-за этого «краснел» тест перевода); два therapy-теста приведены к фактическому поведению
(`client_label` возвращает псевдоним посетителя, а не литерал `client`).

---

## 1. Что сделано 2026-10-26: ключ ИИ на проде

Факты:

- Ключ DeepSeek взят из локального окружения (`DEEPSEEK_API_KEY`), в git, `SERVER_MAP.md` и доку не записан.
- Записан в `/etc/depress/depress.env` (600, root) как `AI_API_KEY`; `AI_BASE_URL=https://api.deepseek.com`,
  `AI_MODEL=deepseek-chat` уже были.
- `sudo systemctl restart depress-api` → `active`; `/api/v1/health` → `{status: ok, database: true, redis: true, channels: true}`.
- Смоук: `POST http://127.0.0.1:8000/api/v1/ai/support` с одним сообщением → **HTTP 200 за 3.1 с**,
  `offline=false`, `crisis=false`, живой ответ («That heaviness you're carrying tonight is real…»).
  Тестовая анонимная сессия удалена сразу после прогона.

Как это устроено (код):

- `backend/apps/ai/gateway.py:85` — `get_gateway()`: пустой `AI_API_KEY` → `OfflineGateway`
  (шаблонный ответ + пометка `[offline mode: no API key configured]`), иначе `OpenAICompatibleGateway`.
- `backend/apps/ai/services.py` — лимит `AI_LIMIT = 30` запросов/час на актора (Redis cache),
  история ≤ 12 сообщений, сообщение ≤ 2000 символов, `surface ∈ {companion, anti_panic}`;
  `apps/ai/crisis.py` подменяет ответ на кризисный шаблон при триггерах.
- `backend/api/v1/ai.py` — `POST /api/v1/ai/support` и SSE `POST /api/v1/ai/support/stream`
  (события `meta → delta* → done`, при ошибке `error`). Дисклеймер «не терапевт, не 112» отдаётся в каждом ответе.

Ротация ключа (2 команды, без редеплоя кода):

```bash
ssh BIA "echo <sudo-pass> | sudo -S -p '' sed -i 's|^AI_API_KEY=.*|AI_API_KEY=<new-key>|' /etc/depress/depress.env"
ssh BIA "echo <sudo-pass> | sudo -S -p '' systemctl restart depress-api"
```

Проверка после ротации: `curl -s http://127.0.0.1:8000/api/v1/health` и смоук `POST /api/v1/ai/support`
(в ответе `offline` должно быть `false`).

Что **не** требует ключа: перевод интерфейса — теперь статические паки
(`apps/*/src/core/i18n/packs/*.json`, генератор `scripts/gen_i18n_packs.mjs`).
`TRANSLATOR_*` остаются пустыми сознательно: рантайм-перевод больше не используется.

Ограничения, о которых стоит помнить:

- Ключ один на инстанс → общий лимит провайдера и общий счёт. Счётчик у нас per-actor (Redis `ai_rl:*`), глобального предохранителя нет.
- При 402/429/сетевой ошибке провайдера пользователь получит `HTTP 400` с текстом ошибки (в SSE — событие `error`), фолбэка на `OfflineGateway` нет.
  Если нужен мягкий деграйд — это отдельная правка в `apps/ai/services.py`.
- История диалога с ИИ не хранится на сервере: клиент присылает последние сообщения; копия — в IndexedDB (Zero-Knowledge).



---

## 2. Четыре поверхности и кто в них ходит

| Поверхность | URL | Кто | Что делает | Ограничения |
|---|---|---|---|---|
| Browser SPA | `https://app.de-press.co/` (вкладка **Helper** → `/helper`) | `is_helper` (и `is_staff` по API) | Живая очередь заявок (WS), облака, сводка, duty-toggle | Вкладка в рейле скрыта для staff, если он не helper (п. B4) |
| Mini App | `https://app.de-press.co/tg/` | `is_helper` | Облака + сводка + duty + приём заявок серыми строками в `/chat` (поллинг 20 с) | Нет живой очереди по WS и нет вкладки Requests (п. B6) |
| Staff-консоль | `https://app.de-press.co/console/` | `is_staff` | Overview (счётчики), Reports (разбор), Moderation log | Только отчёты; вход — через Django-сессию (п. B7) |
| Django admin | `https://app.de-press.co/admin/` | `is_staff` / `is_superuser` | Аккаунты и роли, инвайты, облака bulk-действиями, репорты, аудит, фразы | Дефолтный Django-UI, часть действий идёт мимо сервисов (п. B2) |

Ссылки между поверхностями нет ни в одну сторону: `/console/` не линкуется из приложения,
`/admin/` — из `/console/`. Пока это «знание владельца», а не продукт.

---

## 3. Роли и права

| Действие | Аноним | Аккаунт | Helper | Helper on duty | on duty + online (≤45 с) | Staff | Superuser |
|---|---|---|---|---|---|---|---|
| Создать/отменить заявку помощи | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Видеть `/help/presence` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Heartbeat `POST /help/heartbeat` | ❌ | ❌ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Duty-toggle `POST /me/helper-duty` | ❌ | ❌ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Inbox заявок `GET /help/requests` | ❌ | ❌ | ✅ (пусто вне смены) | ✅ | ✅ | ❌ | ❌ |
| Взять/пропустить заявку | ❌ | ❌ | ✅ *(смена не требуется)* | ✅ | ✅ | ❌ | ❌ |
| Мгновенный мэтч при создании заявки | — | — | — | ✅ | ✅ (least-recent-matched, блокировки учтены) | — | — |
| Очередь облаков + approve/reject | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Подать репорт (история/сообщение) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Разбор репортов `/admin/reports*` | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| Аудит `/admin/moderation-log` | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| Инвайты хелперов | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Вкладка Requests (legacy) | ❌ | ❌ | пусто | пусто | пусто | ❌ | ❌ |

Ключевые асимметрии (сознательные, но их надо знать):

- **Взять заявку можно, будучи off-duty** — смена влияет только на уведомления/инбокс, не на accept. Так задумано в MAINPLAN A5.
- **Инвайты и вкладка Requests требуют on-duty**, хотя создание инвайта — операция «штабная», не «на линии».
- **Staff ≠ Helper**: staff видит облака и консоль, но не heartbeat/duty и не инбокс заявок.

---

## 4. Как этим пользоваться прямо сейчас (прод)

### 4.1. Завести хелпера

Сейчас на проде **один** аккаунт (staff/owner) и ноль хелперов, поэтому Help-путь упирается в «никого нет».
Два способа:

**A. Django admin (быстро, для себя):** `https://app.de-press.co/admin/` → *Accounts* → нужный аккаунт →
галочка `is_helper`, при желании `helper_org` («Pilot», название НКО) и `is_on_duty` → *Save*.
После этого в приложении появляется вкладка **Helper** в левом рейле (в Mini App — пункт в меню аккаунта).

**B. Инвайт (для внешнего волонтёра):** staff или хелпер открывает в приложении `/helper/invite`
(в браузере — пункт в UserMenu, в Mini App — в меню аккаунта) → указывает организацию → получает ссылку
`https://app.de-press.co/helper/join?token=…`. Кандидат **должен быть залогинен аккаунтом** (email/Telegram),
открывает ссылку, ставит обещание («не врач, не 112, могу уйти») → становится хелпером с `helper_org` из инвайта.
Инвайт одноразовый, по умолчанию живёт 168 ч; UI не даёт выбрать TTL, хотя API принимает `ttl_hours`.
Список неиспользованных инвайтов — `/helper` → **Summary**.

### 4.2. Встать на смену

`/helper` → карточка Duty → `On duty` (`POST /api/v1/me/helper-duty {on:true}`).
Пока открыт `/helper` или `/chat`, клиент шлёт heartbeat; «online» = heartbeat ≤ 45 с
(`backend/apps/dialogue/presence.py:16`). Тонкость: если хелпер сидит на `/feed` или `/patterns`,
он **on duty, но не online** → мгновенного мэтча не будет, только персональное уведомление `help_requested`.

### 4.3. Клиент просит человека

`/help` → карточка «Человек рядом» → необязательная заметка (≤280) → `POST /api/v1/help/requests` → `/help/wait`.
Дальше два исхода:

- **Мгновенный мэтч:** есть on-duty+online хелпер без блокировки → сразу создаётся диалог `Dialogue(source=help)`,
  в него пишутся `[rules]`, `[system] Someone asked for a human nearby…` и заметка автора; остальные заявку не видят.
- **Очередь:** заявка `pending` уходит в WS `/ws/helper/queue/` (`snapshot`, `queue.new`, `queue.taken`, `queue.cancelled`)
  и в уведомления on-duty хелперам. Ждущий видит только «кто-то на смене / никого» — без имён и чисел.

Лимит: 5 заявок в час на актора (`HELP_CREATE_LIMIT`); повторный POST возвращает существующую pending-заявку.
Отменить может только автор и только пока `pending`.

### 4.4. Хелпер берёт заявку

`/helper` → **Queue** → «Взять» → открывается `/chat/<id>` с правилами и вступлением.
`Пропустить` скрывает заявку только у этого хелпера (`HelpRequestSkip`), остальным она остаётся.
В Mini App то же самое — серыми строками Help-inbox в списке чатов (поллинг 20 с, без WS-очереди).


### 4.5. Модерация облаков (free-text)

Две двери, один код: `/helper` → **Clouds** и `https://app.de-press.co/console/` → **Clouds** (staff).
FIFO только `pending` + `kind=free_text` (тихие фразы не модерируются вообще).
`Approve` → `delivered`, автору уходит `cloud_approved`. `Reject` → `rejected`, автору **ничего** не уходит.
Доступно хелперам и staff. Каждое решение пишется в `ModerationAction` (кто, что, какое облако) и видно в **Log**.
Django admin → *Support clouds* → bulk-actions теперь тоже идёт через сервисы.

### 4.6. Репорты и решения

- Пользователь: страница истории → `⋯` → *Report* (`POST /stories/{id}/report`). Причина всегда `other`,
  текст не спрашивается (п. B5). В чате — `POST /messages/{id}/report`.
- Разбор: `https://app.de-press.co/console/` → **Reports**: фильтр по статусу, карточка (фрагмент контента ≤600,
  текст жалобы, прежнее решение), форма: `hide | remove | dismiss` + **обязательная** причина + заметка.
  После решения обновляются и очередь, и счётчики Overview, и журнал; внизу — «Показать ещё».
- **Log**: последние 100 записей аудита (кто, что, почему, заметка). Пишется только для репортов.
- Django admin → *Reports*: bulk-actions `Mark reviewing` / `Dismiss` / `Hide`, колонка «сколько открытых на объект».
  Статус `reviewing` из консоли недостижим — только отсюда.

### 4.7. Вкладки Requests больше нет

Она была декоративной: статус `awaiting_helper` никто не выставлял. 2026-10-26 вкладка, три эндпоинта,
сервисы и клиентские методы удалены — вместо них вкладки **Queue / Clouds / Summary** (браузер, Mini App)
и **Overview / Reports / Clouds / Helpers / Log** (консоль).

---

## 5. API-инвентарь (что уже есть)

Заявки помощи (`api/v1/help.py`):

| Метод | Путь | Право |
|---|---|---|
| GET | `/api/v1/help/dashboard` | helper или staff |
| GET | `/api/v1/help/presence` | любой |
| POST | `/api/v1/help/heartbeat` | helper |
| POST | `/api/v1/help/requests` | любой с идентичностью |
| GET | `/api/v1/help/requests/mine` | автор заявки |
| GET | `/api/v1/help/requests` | helper on duty |
| POST | `/api/v1/help/requests/{id}/accept` | helper |
| POST | `/api/v1/help/requests/{id}/skip` | helper |
| POST | `/api/v1/help/requests/{id}/cancel` | автор заявки |

Модерация (`api/v1/moderation.py`, `api/v1/support.py`):

| Метод | Путь | Право |
|---|---|---|
| GET | `/api/v1/moderation/dashboard` | helper или staff |
| GET | `/api/v1/moderation/clouds` | helper или staff |
| POST | `/api/v1/moderation/clouds/{id}/approve` | helper или staff |
| POST | `/api/v1/moderation/clouds/{id}/reject` | helper или staff |
| GET | `/api/v1/moderation/dialogue-requests` | helper on duty (legacy, всегда пусто) |
| POST | `/api/v1/moderation/dialogue-requests/{id}/approve` | helper (legacy) |
| POST | `/api/v1/moderation/dialogue-requests/{id}/reject` | helper (legacy) |
| POST | `/api/v1/stories/{id}/report` | любой |
| POST | `/api/v1/messages/{id}/report` | участник диалога |
| POST/GET/DELETE | `/api/v1/blocks…` | любой |
| GET | `/api/v1/admin/overview` | staff |
| GET | `/api/v1/admin/reports?status=` | staff |
| POST | `/api/v1/admin/reports/{id}/resolve` | staff |
| GET | `/api/v1/admin/moderation-log?limit=` | staff |

Прочее: `POST /api/v1/me/helper-duty`, `POST|GET /api/v1/helper-invites`,
`GET /api/v1/helper-invites/{token}`, `POST /api/v1/helper-invites/{token}/accept`,
`POST /api/v1/ai/support`, `POST /api/v1/ai/support/stream`.

WebSocket: `/ws/helper/queue/` — только `is_helper` (duty не требуется), снимок очереди при подключении.


---

## 6. Модели, на которых всё держится

| Модель | Файл | Зачем |
|---|---|---|
| `Account` (`is_helper`, `is_on_duty`, `helper_org`, `helper_seen_at`, `helper_last_matched_at`) | `backend/apps/identity/models.py:52` | роль, смена, присутствие, «кого давно не матчили» |
| `HelperInvite` | `identity/models.py:139` | одноразовый инвайт (token, org, TTL, used_by) |
| `HelpRequest` / `HelpRequestSkip` | `backend/apps/dialogue/models.py` | заявка (`pending/accepted/cancelled`) и «пропустил» |
| `Dialogue(source=help)` | `dialogue/models.py` | результат accept: обычный диалог без истории |
| `SupportCloud` (`kind`, `status`, `helper_badge`, `moderated_by`, `thread_root`) | `backend/apps/support/models.py:45` | приватное облако автору; бейдж хелпера — снапшот на момент отправки |
| `Report` / `Block` | `backend/apps/moderation/models.py` | жалобы и блокировки |
| `ModerationAction` | `moderation/models.py:212` | аудит решений по репортам (актор, действие, обязательная причина, заметка) |
| `Notification` | `backend/apps/notifications/models.py` | `help_requested`, `help_accepted`, `cloud_approved`, `dialogue_request`, … |

Инварианты, которые нельзя ломать: `is_helper ≠ врач`; кризис → 112/103 + Anti-Panic;
публичных счётчиков нет; имена хелперов пользователю не показываются (только «кто-то на смене»).

---

## 7. Что криво (баги и недоделки, с точными местами)

Sev: **BLK** — блокирует пилот, **M** — мешает каждый день, **L** — косметика/долг. Номера B1…B16 — просто ID дефектов.

| # | Sev | Что | Где | Эффект | Минимальный фикс |
|---|---|---|---|---|---|
| B1 | **M** | Вкладка **Requests** мертва: `awaiting_helper` никто не выставляет | `apps/dialogue/services.py:325` (`Legacy… skip this gate`), `api/v1/moderation.py:194-223`, `apps/browser/src/features/helper/HelperQueue.tsx` (tab `requests`) | Хелпер видит пустой экран и копирайт про «мы проверили»; поддержка думает, что гейт работает | либо удалить вкладку + эндпоинты + i18n-ключи, либо вернуть запись `AWAITING_HELPER` в `request_dialogue`. Решение — за владельцем |
| B2 | **BLK** | Два пути модерации облаков: Django-admin actions пишут статус напрямую | `apps/support/admin.py:15-36` vs `apps/support/services.py:596-644` | Облако «доставлено», но автор не получил `cloud_approved`; расходится с API-поведением | в actions вызывать `approve_cloud`/`reject_cloud` (actor из `request.user`), а не менять поля |
| B3 | **M** | Модерация облаков не попадает в аудит | `ModerationAction` пишется только в `resolve_report` | Невозможно ответить «кто отклонил облако и почему» | добавить `cloud` FK + `CLOUD_APPROVED/CLOUD_REJECTED` в `ModerationActionKind` (миграция) и писать в сервисах |
| B4 | **M** | Staff не видит вкладку Helper в рейле | `apps/browser/src/components/layout/Sidebar.tsx:78-80` (`key === "helper" && !isHelper`) | У owner (`is_staff`, не `is_helper`) нет входа в `/helper`, хотя страница и API разрешают | `!isHelper && !isStaff` в фильтре |
| B5 | **BLK** | Репорт истории всегда `other`, без деталей | `apps/browser/src/features/feed/StoryPage.tsx:349-350` (`api.reportStory(id, "other")`) | В очереди нет причин, разбор вслепую; self-harm не отличить от спама | мини-форма: выбор `abuse/spam/self_harm/other` + поле деталей (API уже принимает) |
| B6 | **M** | Mini App: нет живой очереди и вкладки Requests | `apps/mini-app/src/features/helper/HelperQueue.tsx:8` (`Tab = clouds \| summary`), `ChatList.tsx:60-66` (поллинг 20 с) | Хелпер в Telegram узнаёт о заявке с задержкой до 20 с и не видит очередь | либо `useHelperQueue` в mini (WS уже есть), либо честная плашка «очередь — в браузере» |
| B7 | **M** | `/console/` без формы входа | `apps/admin/src/App.tsx:21-33` | Staff упирается в «Access denied» со ссылкой на приложение вместо `/admin/login` | ссылка на `/admin/login/?next=/console/` + подсказка |
| B8 | **M** | После решения по репорту не обновляются Overview и Log | `apps/admin/src/features/Reports.tsx:33-37` | Счётчики и аудит врут до перезагрузки страницы | добавить `invalidateQueries(["admin-overview"])` и `["admin-log"]` |
| B9 | **M** | `onError` вызывается во время рендера (setState из render) | `apps/admin/src/features/{Overview.tsx:22-24,Reports.tsx:39-41,ModerationLog.tsx:14-16}` | React-warning «Cannot update a component while rendering…», возможны лишние ререндеры | перенести в `useEffect` |
| B10 | **M** | Нет пагинации/поиска | `api/v1/moderation.py:407-421` (`limit ≤ 100`), `:444-450` (`≤ 200`), UI жёстко 50/100 | На росте данных разбор превращается в листание вслепую | курсор/offset + «показать ещё» |
| B11 | **L** | Сырые статусы и дубли переводов | `HelperQueue.tsx:408` (`row.status` как есть), `reasonLabel` продублирован в browser/mini | Английские `open/reviewing` в русском UI | `t.statuses[row.status]`, общий helper-маппинг |
| B12 | **L** | Консоль не показывает очередь хелпов и on-duty | `build_admin_overview` (`apps/moderation/dashboard.py:100`) | Staff не видит «сколько людей ждут» без перехода в `/helper` | добавить 2 счётчика из `helper_dashboard_metrics()` |
| B13 | **L** | `recent_reports` в хелпер-дашборде — все статусы | `apps/moderation/dashboard.py:47` | «Recent reports» показывает уже разобранное | фильтр `status__in=("open","reviewing")` |
| B14 | **L** | Уведомление о мэтче уходит хелперу с типом `HELP_ACCEPTED` | `apps/dialogue/help.py:149-153` | Семантически неверный тип для хелпера; путает в инбоксе | отдельный `HELP_MATCHED` или переиспользовать `HELP_REQUESTED` |
| B15 | **L** | Инвайты нельзя отозвать, TTL не выбирается в UI | `api/v1/helper_invite.py:18-21`, `HelperJoin.tsx` | Просроченные/утекшие ссылки живут до истечения | `DELETE /helper-invites/{token}` + поле TTL |
| B16 | **L** | Подтверждение и результат в консоли не показываются | `Reports.tsx` (нет success-состояния) | Непонятно, применилось ли решение | тост/строка «решение сохранено» |

**Статус 2026-10-26: B1–B16 закрыты** (см. §0 «Что закрыто в P0»). Остаточные мелочи: причина репорта
в чате всё ещё фиксированная (`abuse`), у очереди облаков нет фильтров/поиска.


---

## 8. Бэклог: что доработать (приоритеты и объём)

### P0 — сделано 2026-10-26 (детали в §0)

1. **Завести хелпера + смену на проде.** Не код: Django admin → `is_helper` + `is_on_duty`
   (или инвайт). Плюс решить, кто второй, чтобы не было bus factor = 1.
2. **B2 + B3 — один путь модерации облаков.** Django-admin actions → сервисы; аудит по облакам.
   Объём: миграция `ModerationAction` (+`cloud`, +2 вида), ~40 строк, тесты на оба пути.
3. **B5 — причина репорта.** Форма в `StoryPage` (и для сообщений в чате): 4 причины + детали.
   Объём: ~60 строк UI + i18n, API готов.
4. **B8 + B9 — консоль: кэш и рендер.** ~15 строк, без миграций.
5. **B7 — вход в консоль.** Ссылка на `/admin/login/?next=/console/`. 3 строки.
6. **B4 — Helper-вкладка для staff.** 1 строка (+ проверить mini).

### P1 — что осталось после батча 2026-10-26

7. **B1 — решить судьбу Requests.** Рекомендация: удалить (вкладка + 3 эндпоинта + i18n),
   чтобы не обещать «проверено хелпером». Если гейт нужен — вернуть `AWAITING_HELPER` в `request_dialogue`
   и уведомление `dialogue_request_review`.
8. **B6 — Mini App: живая очередь.** Переиспользовать `useHelperQueue` (WS уже на бэке) — ~80 строк.
9. **B10 — пагинация** отчётов и лога, фильтр по датам; на бэке — cursor.
10. **Консоль: модерация облаков** (вкладка Clouds с approve/reject) — переиспользовать `api.moderationQueue`,
    чтобы staff не ходил в основное приложение.
11. **Консоль: управление хелперами** (список `is_helper`, duty, org, инвайты) — 1 эндпоинт + таблица.
12. **B11/B13** — i18n статусов и фильтр «только открытые» в дашборде.

### P2 — после пилота

13. Терапевтический контур в консоли (`TherapistProfile`: инвайты, сессии, оплаты) —
    сейчас управляется только через Django admin, на проде 0 профилей.
14. Тихие фразы (редактор + картинки) и фонд в консоли.
15. B15 — отзыв инвайтов, TTL в UI, список организаций.
16. Экспорт/выгрузка аудита, SLA-отчёт по ожиданию (медиана уже считается в `/help/dashboard`).
17. Единая навигация: ссылки между `/console/`, `/admin/`, `/helper`.

---

## 9. Состояние прода (live, 2026-10-26)

Проверено через `manage.py shell` на сервере:

| Показатель | Значение | Что значит |
|---|---|---|
| Accounts / helpers / on_duty | 1 / 0 / 0 | Help-путь никем не обслуживается; мэтч невозможен |
| Staff | 1 | Консоль и Django admin доступны владельцу |
| HelperInvite (всего / неиспользованных) | 0 / 0 | Онбординг не запускался |
| Reports (open / reviewing) | 0 / 0 | Очередь жалоб пуста (и репорты почти не отправляются — см. B5) |
| SupportCloud pending | 0 | Модерировать нечего |
| TherapistProfile | 0 | Терапевтический контур не запущен |
| Истории в ленте | 55 published-корней / 75 записей всего, 33 разных автора-сессии | Демо-контент на месте; рост с 32 (зафиксировано в PROGRESS 2026-10-23) — см. примечание ниже |
| `AI_API_KEY` | задан (35 симв.) | ИИ-чат живой |

Примечание к контенту: все 55 опубликованных корней имеют даты 2026-09-25…2026-10-22, из них **19 — на 2026-10-20**.
Демо-сид 2026-10-23 раскладывал 30 историй примерно по одной в день, поэтому кластер из 19 за один день
и рост 32 → 55 **не атрибутированы** в этом проходе (похоже на ещё одну забэкдейченную пачку, залитую после 23.10).
Это не влияет на ИИ-чат и модерацию, но если реальный трафик не ожидался — стоит уточнить происхождение.

Практический вывод: на проде сейчас **включён только ИИ-путь** (`/help/ai`) и админ-консоль.
Человеческая помощь требует одного действия — выдать роль хелпера и смену.

---

## 10. Операции и проверки

```bash
# Консоль/админка живы
curl -s -o /dev/null -w '%{http_code}\n' https://app.de-press.co/console/
curl -s -o /dev/null -w '%{http_code}\n' https://app.de-press.co/admin/

# ИИ-чат (на сервере, без внешнего трафика)
ssh BIA "curl -s -X POST http://127.0.0.1:8000/api/v1/ai/support -H 'Content-Type: application/json' \
  -d '{\"messages\":[{\"role\":\"user\",\"content\":\"ping\"}]}'"   # offline должно быть false
```

Деплой (по `DEPLOY.md` §7, git на сервере нет):

- бэкенд: `git archive | tar` → rsync в `/opt/de-press` → `migrate` / `collectstatic` / `systemctl restart depress-api depress-celery depress-celery-beat`;
- фронтенды собираются локально: `apps/browser`, `apps/mini-app`, `apps/admin` (`base=/console/`), затем rsync `dist`
  в `/opt/de-press/apps/*/dist`; nginx отдаёт `/console/` через `try_files … /console/index.html` + `X-Robots-Tag: noindex`.

Проверки после деплоя: `systemctl is-active depress-api depress-celery depress-celery-beat`,
`/api/v1/health`, `/`, `/tg/`, `/console/` → 200, `journalctl -u depress-api -p err --since '15 min ago'` пуст.

---

## 11. Прод-прогон руками (15 минут, два окна)

Нужны два окна: **A** — основной браузер, залогинен аккаунтом владельца; **B** — инкогнито (посетитель).

1. **Вход в консоль.** В окне A открой `https://app.de-press.co/admin/login/?next=/console/`, войди staff-аккаунтом →
   попадёшь в `/console/`. Вкладки: Overview, Reports, Clouds, Helpers, Log.
2. **Роль хелпера.** В `/console/` → **Helpers**: должна быть строка с твоим email, `Не на смене`.
   В рейле приложения появилась вкладка **Helper** (раньше её видели только `is_helper`).
3. **Смена.** `/helper` → карточка Duty → «Встать на смену». В Summary: «На смене», в Helpers начнёт расти
   «Последний heartbeat» (пока открыт `/helper` или `/chat`).
4. **Очередь.** Пока ты **не на смене** (сними галочку), в окне B: `https://app.de-press.co/help` →
   «Человек рядом» → заметка → отправить. Заявка уйдёт в очередь. Вернись в A, включи смену →
   вкладка **Queue** покажет заявку с ожиданием; «Взять» → откроется `/chat/<id>` с правилами и заметкой.
5. **Мгновенный мэтч.** Оставь смену включённой и `/helper` открытым, в окне B отправь ещё одну заявку
   (или новое инкогнито) → диалог откроется сразу, без очереди.
6. **Облака.** В окне B открой любую чужую историю → «Поддержать» → свободный текст → отправить.
   В A: `/helper` → **Clouds** (или `/console/` → **Clouds**) → «Одобрить». В `Log` появится
   «Облачко одобрено» с твоим email.
7. **Репорт и решение.** В окне B на истории → `⋯` → Report → выбери причину (например, «Спам»),
   добавь детали → Send. В A: `/console/` → **Reports** → «Решить» → `Скрыть` + причина → сохранение.
   Проверь: карточка исчезла из open-очереди, счётчики Overview обновились, в `Log` — запись.
8. **Облака через Django admin** (второй путь): `/admin/` → *Support clouds* → bulk-«Approve» — теперь он тоже
   уведомляет автора и пишет аудит (раньше молча менял статус).
9. **Приглашения.** `/helper/invite` → выбери TTL (24 ч / 7 д / 30 д) → создай ссылку. В `/helper` → Summary
   рядом с неиспользованным инвайтом есть «Удалить» — отзыв работает.

Если нужно убрать тестовые данные после прогона: заявки/облака/репорты удаляются точечно через
`manage.py shell` (те же приёмы, что в §9/`SERVER_MAP.md`), либо просто оставить — на проде это безвредно.

---

## 12. Что осталось не проверенным в этом проходе

- Живой браузерный прогон очереди (нужен хелпер + второй клиент) — не делался, чтобы не менять роли на проде.
- Rate-limit ИИ (30/час) и поведение при 429 провайдера — проверено только чтением кода.
- Мобильная раскладка `/console/` — не смотрели (консоль проектировалась как десктопная).

