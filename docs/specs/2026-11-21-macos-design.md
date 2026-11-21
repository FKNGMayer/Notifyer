# Notifyer для macOS

Дата: 2026-11-21. Цель: та же программа на macOS (Intel и Apple Silicon), Windows-версия не меняется.
Проверка вживую — только по готовому релизу, поэтому платформенный код держим минимальным
и опираемся на то, что уже есть в Tauri.

## Что видит пользователь

### Остров
- На Mac с вырезом (notch) верхний остров вырастает из выреза: чисто чёрная капсула, верхний край
  прижат к краю экрана, по центру выреза, шире него. Содержимое начинается ниже выреза
  (`padding-top` = высота выреза). Следующие острова — отдельные чёрные капсулы ниже, с зазором.
  Когда верхний уходит, следующий поднимается и сам прирастает к вырезу (анимируются `top`,
  `height`, радиусы и отступ).
- Без выреза (старые Mac, внешний монитор как основной): чёрные капсулы сверху по центру,
  с отступом от края, поверх строки меню.
- Окно острова выше строки меню (`NSStatusWindowLevel`), видно на всех рабочих столах и поверх
  полноэкранных приложений; не прячется вместе с приложением (`canHide = false`).
- Остальное как на Windows: наведение раскрывает `10 мин` / `1 ч` / `✓` и ставит таймер на паузу,
  пустые места пропускают клики.
- Блюра у островов на Mac нет — как у Dynamic Island, чёрный цвет сливается с вырезом.

### Строка ввода и настройки
- Системный материал macOS (`NSVisualEffectView`, эффект `HudWindow`) через встроенные
  window effects Tauri со скруглением `--panel-radius`, нативная тень окна.
- Окно ровно по размеру панели: CSS-тень и прозрачный запас (`--shadow-room`) на Mac обнуляются.
- Анимация `pop-in` на Mac выключена: нативный блюр не масштабируется вместе с CSS.
- Скрытие строки ввода/настроек возвращает фокус предыдущему приложению (`AppHandle::hide`,
  если ни одно из этих двух окон больше не видно).

### Приложение
- Только значок в строке меню (template-иконка, монохромная); в Dock не появляется
  (`LSUIElement` + `ActivationPolicy::Accessory`). Клик по значку открывает меню — так принято на Mac;
  первый пункт «Новая заметка».
- Горячая клавиша по умолчанию та же `Ctrl+Alt+N`, на Mac это `⌃⌥N`. Клавиши показываются
  значками `⌃ ⌥ ⇧ ⌘`, `Super` = `⌘`.
- Хранилище Obsidian: `~/Library/Application Support/obsidian/obsidian.json`.
- Автозапуск: LaunchAgent (plugin-autostart). Подпись строки — «Открывать при входе в систему».
- Скрипты и Stream Deck: `/Applications/Notifyer.app/Contents/MacOS/Notifyer --add "…"`.

### Распространение
- Один universal `.dmg` из релизного workflow, стабильное имя `Notifyer.dmg` для ссылки в README.
- Без Developer ID: ad-hoc подпись, в README инструкция «Конфиденциальность и безопасность →
  Всё равно открыть». Подпись Apple добавляется позже секретами CI, без изменений кода.

## Архитектура

### Rust
- Платформенный код в своих модулях, в `lib.rs` только точки вызова:
  - `glass.rs` остаётся только для Windows;
  - новый `mac.rs` (`#[cfg(target_os = "macos")]`, objc2 + objc2-app-kit):
    `notch(&WebviewWindow) -> Notch { width, height }` по основному экрану
    (`NSScreen::screens()[0]`: `safeAreaInsets.top`, ширина минус `auxiliaryTopLeftArea` и
    `auxiliaryTopRightArea`; macOS < 12 → нет выреза), `raise_popup` (уровень, collection behavior,
    `canHide`), `invalidate_shadow`.
- `lib.rs`: `SHADOW_INSET` = 0 на Mac; попап на Mac ставится к верху экрана (`monitor.position`),
  а не рабочей области; команда `popup_geometry` отдаёт фронтенду вырез; на Mac окнам
  quick/settings включаются effects и тень при создании; трей — template-иконка и меню по клику;
  `release_focus` после скрытия.
- `config.rs`: путь к `obsidian.json` по платформе.
- `Cargo.toml`: фича `macos-private-api` у tauri (прозрачные окна на Mac, на Windows ничего не
  делает), objc2/objc2-app-kit только для `target_os = "macos"`.
- `tauri.conf.json`: `macOSPrivateApi: true`. `tauri.macos.conf.json` (Tauri подмешивает сам):
  `bundle.targets: ["dmg"]`, `minimumSystemVersion`. `Info.plist`: `LSUIElement`.

### Фронтенд
- `lib/platform.ts`: `isMac` по `navigator.userAgent`; `main.tsx` ставит `data-platform` на `<html>`.
- `base.css`: под `[data-platform="mac"]` — `--shadow-room: 0`, без CSS-тени панели, светлее тонировка,
  без `pop-in`; шрифт `-apple-system` в фолбэках.
- `hotkey.ts`: `keycaps(accelerator, mac)` — значки Mac.
- `Popup.tsx`: раскладка с учётом выреза — чистая функция `layoutIslands(cards, measures, hovered, notch)`
  в `lib/islands.ts` с тестами vitest. `popup.css`: чёрный фон на Mac, стиль `is-notched`.
- `Settings.tsx`: подпись автозапуска по платформе.

### Сборка
- `release.yml`: матрица windows + macos; на macOS `--target universal-apple-darwin`
  (оба Rust-таргета), загрузка `Notifyer.dmg` под стабильным именем.
- README: кнопка «Скачать для macOS», раздел про первый запуск без подписи, Mac-сочетания.

## Проверка без Mac
- `cargo check --target aarch64-apple-darwin` локально (C-компилятор для `objc2-exception-helper`
  подменяется заглушкой — для check объектный код не нужен).
- `cargo test`, `npm test` (раскладка островов с вырезом и без), `npm run build`.
- Превью острова в браузере с замоканным IPC и нарисованным вырезом — скриншоты обоих режимов.
- Windows-сборка не должна измениться: `cargo check` + `npm run app` на Windows.
- Ручная проверка на Mac — по первому релизу.
