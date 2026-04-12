/**
 * Centralized POS error handling: friendly Vietnamese UI + full technical debug.
 * @see handleAppError(errorCode, debugData, options)
 *
 * ❌ DO NOT use window.confirm in application code — use haConfirmAsync() or
 *    confirmAsync() from app.js (shim + postMessage → Next ConfirmDialog).
 */
(function (global) {
    'use strict';

    /** Native confirm — dùng cho fallback; không gọi window.confirm sau khi shim (tránh vòng lặp). */
    if (typeof global.__haNativeConfirm !== 'function') {
        global.__haNativeConfirm = global.confirm.bind(global);
    }

    var USER_MESSAGES = {
        missing_shop_context: 'Phiên làm việc đã hết hạn. Vui lòng đăng nhập lại.',
        unauthorized: 'Không thể xác thực tài khoản. Vui lòng đăng nhập lại.',
        stale_data: 'Dữ liệu vừa được cập nhật ở nơi khác. Vui lòng tải lại để tiếp tục.',
        missing_write_version: 'Phiên bản dữ liệu không khớp. Vui lòng tải lại trang rồi thử lưu lại.',
        demo_seed_forbidden: 'Không thể tạo dữ liệu mẫu vì cửa hàng đã có dữ liệu.',
        network_error: 'Kết nối không ổn định. Vui lòng kiểm tra mạng.',
        unknown_error: 'Có lỗi xảy ra. Vui lòng thử lại.',
        trial_expired:
            'Thời gian dùng thử đã hết. Bạn không thể tải hoặc lưu dữ liệu bán hàng cho đến khi nâng cấp và thanh toán theo hướng dẫn. Bấm «Nâng cấp ngay» để nhận thông tin chuyển khoản.',
        trial_slug_mismatch:
            'Tài khoản dùng thử và địa chỉ cửa hàng trên trình duyệt hiện không khớp. Hãy đăng xuất rồi đăng nhập lại, hoặc mở đúng link cửa hàng mà hệ thống đã cấp.',
        production_trial_prefix_forbidden:
            'Tên cửa hàng không phù hợp với trạng thái tài khoản (đã kích hoạt). Vui lòng liên hệ hỗ trợ nếu bạn cần chỉnh sửa.',
        trial_backup_required:
            'Dữ liệu cửa hàng dùng thử phải nằm trong kho dùng thử. Vui lòng tải lại trang hoặc đăng nhập lại.',
        production_backup_required:
            'Dữ liệu cửa hàng đã kích hoạt phải nằm trong kho chính. Vui lòng tải lại trang hoặc đăng nhập lại.',
    };

    /** Backend / internal codes → canonical user-facing code */
    var CODE_ALIASES = {
        missing_shop_slug: 'missing_shop_context',
        missing_shop_context: 'missing_shop_context',
    };

    function normalizeCode(code) {
        var c = String(code || '').trim();
        if (!c) return 'unknown_error';
        return CODE_ALIASES[c] || c;
    }

    function userMessageFor(code) {
        var n = normalizeCode(code);
        return USER_MESSAGES[n] || USER_MESSAGES.unknown_error;
    }

    function haEscapeHtml(str) {
        if (str == null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function removeErrorModal() {
        var el = document.getElementById('ha-app-error-modal');
        if (el) el.remove();
    }

    /** Thay window.confirm — không dùng alert/confirm gốc. */
    function haShowConfirmModal(opts) {
        removeErrorModal();
        var title = opts.title || 'Xác nhận';
        var message = opts.message || '';
        var okLabel = opts.confirmLabel || 'Xác nhận';
        var cancelLabel = opts.cancelLabel || 'Hủy';
        var primaryClass = 'ha-app-error-modal__btn ha-app-error-modal__btn--primary';
        if (opts.variant === 'danger') primaryClass += ' ha-app-error-modal__btn--danger';
        else if (opts.variant === 'warning') primaryClass += ' ha-app-error-modal__btn--warning';
        else if (opts.variant === 'info') primaryClass += ' ha-app-error-modal__btn--info';
        var iconHtml = '';
        if (opts.icon) {
            iconHtml =
                '<div class="ha-app-error-modal__icon" aria-hidden="true">' +
                haEscapeHtml(opts.icon) +
                '</div>';
        }
        var id = 'ha-app-error-modal';
        var html =
            '<div id="' +
            id +
            '" class="ha-app-error-modal" role="dialog" aria-modal="true">' +
            '<div class="ha-app-error-modal__backdrop"></div>' +
            '<div class="ha-app-error-modal__card">' +
            iconHtml +
            '<h2 class="ha-app-error-modal__title">' +
            haEscapeHtml(title) +
            '</h2>' +
            '<p class="ha-app-error-modal__msg">' +
            haEscapeHtml(message) +
            '</p>' +
            '<div class="ha-app-error-modal__actions">' +
            '<button type="button" class="ha-app-error-modal__btn ha-app-error-modal__btn--secondary" id="ha-app-confirm-cancel">' +
            haEscapeHtml(cancelLabel) +
            '</button>' +
            '<button type="button" class="' +
            primaryClass +
            '" id="ha-app-confirm-ok">' +
            haEscapeHtml(okLabel) +
            '</button>' +
            '</div></div></div>';
        document.body.insertAdjacentHTML('beforeend', html);
        var btnOk = document.getElementById('ha-app-confirm-ok');
        var btnCancel = document.getElementById('ha-app-confirm-cancel');
        if (btnOk) {
            btnOk.onclick = function () {
                removeErrorModal();
                if (typeof opts.onConfirm === 'function') opts.onConfirm();
            };
        }
        if (btnCancel) {
            btnCancel.onclick = function () {
                removeErrorModal();
                if (typeof opts.onCancel === 'function') opts.onCancel();
            };
        }
        if (btnCancel) {
            try {
                btnCancel.focus();
            } catch (_) {}
        }
    }

    /**
     * Promise xác nhận: trong iframe Next shop → modal React (postMessage);
     * trang legacy độc lập → haShowConfirmModal; fallback → window.confirm.
     * @param {{ title?: string, message?: string, confirmLabel?: string, cancelLabel?: string, icon?: string, variant?: string }} opts
     * @returns {Promise<boolean>}
     */
    function haConfirmAsync(opts) {
        opts = opts || {};
        return new Promise(function (resolve) {
            var origin;
            try {
                origin = global.location && global.location.origin ? global.location.origin : '';
            } catch (e) {
                origin = '';
            }
            if (
                typeof global.parent !== 'undefined' &&
                global.parent !== global &&
                origin
            ) {
                var requestId =
                    'hc_' +
                    Date.now() +
                    '_' +
                    Math.random().toString(36).slice(2, 11);
                var settled = false;
                function finish(val) {
                    if (settled) return;
                    settled = true;
                    try {
                        clearTimeout(timeoutId);
                    } catch (_) {}
                    global.removeEventListener('message', onMsg);
                    resolve(!!val);
                }
                function onMsg(e) {
                    if (!e || e.source !== global.parent) return;
                    if (e.origin !== origin) return;
                    var data = e.data;
                    if (
                        !data ||
                        data.type !== 'HANGHO_CONFIRM_RESULT' ||
                        data.requestId !== requestId
                    ) {
                        return;
                    }
                    finish(data.ok);
                }
                var timeoutId = setTimeout(function () {
                    var r;
                    try {
                        r = global.__haNativeConfirm(String(opts.message || ''));
                    } catch (e) {
                        r = false;
                    }
                    finish(r);
                }, 120000);
                global.addEventListener('message', onMsg);
                try {
                    global.parent.postMessage(
                        {
                            type: 'HANGHO_CONFIRM',
                            requestId: requestId,
                            options: {
                                title: opts.title,
                                message: opts.message,
                                confirmLabel: opts.confirmLabel,
                                cancelLabel: opts.cancelLabel,
                                icon: opts.icon,
                                variant:
                                    opts.variant === 'danger' ||
                                    opts.variant === 'default' ||
                                    opts.variant === 'warning' ||
                                    opts.variant === 'info'
                                        ? opts.variant
                                        : undefined,
                                closeOnBackdrop:
                                    opts.closeOnBackdrop === false ? false : undefined,
                                closeOnEscape:
                                    opts.closeOnEscape === false ? false : undefined,
                            },
                        },
                        origin
                    );
                } catch (err) {
                    var r2;
                    try {
                        r2 = global.__haNativeConfirm(String(opts.message || ''));
                    } catch (e2) {
                        r2 = false;
                    }
                    finish(r2);
                }
                return;
            }
            if (typeof haShowConfirmModal === 'function') {
                haShowConfirmModal({
                    title: opts.title,
                    message: opts.message,
                    confirmLabel: opts.confirmLabel || 'Xác nhận',
                    cancelLabel: opts.cancelLabel || 'Hủy',
                    icon: opts.icon,
                    variant: opts.variant,
                    onConfirm: function () {
                        resolve(true);
                    },
                    onCancel: function () {
                        resolve(false);
                    },
                });
                return;
            }
            resolve(global.__haNativeConfirm(String(opts.message || '')));
        });
    }

    /**
     * Parse HTTP body for debug (never show raw to user).
     * @returns {{ code: string, serverError: string, serverMessage: string, requestId?: string }}
     */
    function haParseSyncHttpError(status, rawText) {
        var j = null;
        try {
            j = rawText ? JSON.parse(rawText) : null;
        } catch (_) {
            j = null;
        }
        var serverMessage = j && typeof j.message === 'string' ? j.message : '';
        var serverError = j && j.error != null ? String(j.error) : '';
        var requestId = j && j.requestId != null ? String(j.requestId) : undefined;

        var code = 'unknown_error';
        if (status === 401) code = 'unauthorized';
        else if (status === 400) {
            if (serverError === 'missing_write_version') code = 'missing_write_version';
            else code = 'unknown_error';
        }         else if (status === 403) {
            if (serverError === 'missing_shop_slug') code = 'missing_shop_context';
            else if (serverError === 'delete_forbidden') code = 'unknown_error';
            else if (serverError === 'trial_expired') code = 'trial_expired';
            else if (serverError === 'trial_slug_mismatch') code = 'trial_slug_mismatch';
            else if (serverError === 'production_trial_prefix_forbidden')
                code = 'production_trial_prefix_forbidden';
            else if (serverError === 'trial_backup_required') code = 'trial_backup_required';
            else if (serverError === 'production_backup_required')
                code = 'production_backup_required';
            else code = 'unknown_error';
        } else if (status === 409) {
            if (serverError === 'stale_data') code = 'stale_data';
            else if (serverError === 'transaction_aborted') code = 'stale_data';
            else if (serverError === 'demo_seed_forbidden') code = 'demo_seed_forbidden';
            else code = 'unknown_error';
        } else if (status >= 500 || status === 0) code = 'network_error';

        return {
            code: code,
            serverError: serverError,
            serverMessage: serverMessage,
            requestId: requestId,
            rawSnippet: rawText && rawText.length > 800 ? rawText.slice(0, 800) : rawText,
        };
    }

    function showErrorModal(opts) {
        removeErrorModal();
        var title = opts.title || 'Thông báo';
        var message = opts.message || '';
        var primaryLabel = opts.primaryLabel || 'Đóng';
        var secondaryLabel = opts.secondaryLabel || '';
        var id = 'ha-app-error-modal';
        var html =
            '<div id="' +
            id +
            '" class="ha-app-error-modal" role="alertdialog" aria-modal="true" aria-labelledby="ha-app-error-title">' +
            '<div class="ha-app-error-modal__backdrop"></div>' +
            '<div class="ha-app-error-modal__card">' +
            '<h2 id="ha-app-error-title" class="ha-app-error-modal__title">' +
            haEscapeHtml(title) +
            '</h2>' +
            '<p class="ha-app-error-modal__msg">' +
            haEscapeHtml(message) +
            '</p>' +
            '<div class="ha-app-error-modal__actions">' +
            (secondaryLabel
                ? '<button type="button" class="ha-app-error-modal__btn ha-app-error-modal__btn--secondary" id="ha-app-error-secondary">' +
                  haEscapeHtml(secondaryLabel) +
                  '</button>'
                : '') +
            '<button type="button" class="ha-app-error-modal__btn ha-app-error-modal__btn--primary" id="ha-app-error-primary">' +
            haEscapeHtml(primaryLabel) +
            '</button>' +
            '</div></div></div>';
        document.body.insertAdjacentHTML('beforeend', html);
        var root = document.getElementById(id);
        var btnP = document.getElementById('ha-app-error-primary');
        var btnS = document.getElementById('ha-app-error-secondary');
        if (btnP) {
            btnP.onclick = function () {
                removeErrorModal();
                if (typeof opts.onPrimary === 'function') opts.onPrimary();
            };
        }
        if (btnS) {
            btnS.onclick = function () {
                removeErrorModal();
                if (typeof opts.onSecondary === 'function') opts.onSecondary();
            };
        }
        if (root) {
            var backdrop = root.querySelector('.ha-app-error-modal__backdrop');
            if (backdrop) {
                backdrop.onclick = function () {
                    removeErrorModal();
                    if (typeof opts.onDismiss === 'function') opts.onDismiss();
                };
            }
        }
    }

    function showToastError(message, durationMs) {
        var gApp = global.app;
        if (gApp && typeof gApp.showNotification === 'function') {
            gApp.showNotification(message, 'error', durationMs != null ? durationMs : 6500);
            return;
        }
        showErrorModal({
            title: 'Thông báo',
            message: message,
            primaryLabel: 'Đóng',
            onPrimary: function () {},
        });
    }

    function renderFullscreen(container, opts) {
        if (!container) return;
        var title = opts.title || 'Không thể tải dữ liệu';
        var message = opts.message || '';
        var pHtml = haEscapeHtml(message);
        var b1 = opts.primaryLabel || 'Thử lại';
        var b2 = opts.secondaryLabel || '';
        var id1 = 'ha-fs-err-p';
        var id2 = 'ha-fs-err-s';
        container.innerHTML =
            '<div class="ha-app-error-full fade-in">' +
            '<div class="ha-app-error-full__inner">' +
            '<h2 class="ha-app-error-full__title">' +
            haEscapeHtml(title) +
            '</h2>' +
            '<p class="ha-app-error-full__text">' +
            pHtml +
            '</p>' +
            '<div class="ha-app-error-full__actions">' +
            (b2
                ? '<button type="button" class="ha-app-error-full__btn ha-app-error-full__btn--ghost" id="' +
                  id2 +
                  '">' +
                  haEscapeHtml(b2) +
                  '</button>'
                : '') +
            '<button type="button" class="ha-app-error-full__btn ha-app-error-full__btn--primary" id="' +
            id1 +
            '">' +
            haEscapeHtml(b1) +
            '</button>' +
            '</div></div></div>';
        var elp = document.getElementById(id1);
        var els = document.getElementById(id2);
        if (elp && typeof opts.onPrimary === 'function') elp.onclick = opts.onPrimary;
        if (els && typeof opts.onSecondary === 'function') els.onclick = opts.onSecondary;
    }

    /**
     * @param {string} errorCode
     * @param {Record<string, unknown>} [debugData]
     * @param {{
     *   silent?: boolean,
     *   skipLog?: boolean,
     *   ui?: 'toast' | 'modal' | 'fullscreen',
     *   container?: HTMLElement,
     *   title?: string,
     *   primaryLabel?: string,
     *   onPrimary?: () => void,
     *   secondaryLabel?: string,
     *   onSecondary?: () => void,
     *   durationMs?: number
     * }} [options]
     */
    // Throttle: tránh spam toast cùng loại lỗi liên tục (network/unknown có thể bùng phát nhanh)
    var _errorThrottle = {}; // { code: lastShownAt }
    var ERROR_THROTTLE_MS = 12000; // 12s — cùng lỗi chỉ hiện 1 lần mỗi 12 giây

    function handleAppError(errorCode, debugData, options) {
        options = options || {};
        var n = normalizeCode(errorCode);
        var debug = debugData && typeof debugData === 'object' ? debugData : {};

        if (!options.skipLog) {
            console.error('[APP_ERROR]', Object.assign({ code: n }, debug));
            global.__LAST_ERROR = {
                code: n,
                debug: debugData != null && typeof debugData === 'object' ? debugData : debug,
                time: Date.now(),
            };
        }

        if (options.silent) return;

        // stale_data vẫn hiển thị toast nhẹ để người dùng biết dữ liệu vừa được cập nhật ở nơi khác.
        if (n === 'stale_data' && !options.ui) {
            options.ui = 'toast';
            options.durationMs = options.durationMs || 3500;
        }

        // Throttle: network_error và unknown_error chỉ hiện toast tối đa 1 lần / 12s
        // tránh spam khi server thoáng lỗi rồi tự hồi phục.
        if ((n === 'network_error' || n === 'unknown_error') && !options.force) {
            var lastShown = _errorThrottle[n] || 0;
            if (Date.now() - lastShown < ERROR_THROTTLE_MS) return;
            _errorThrottle[n] = Date.now();
        } else if (n !== 'network_error' && n !== 'unknown_error') {
            // Reset throttle cho lỗi khác loại → cho phép hiện lại ngay
            delete _errorThrottle.network_error;
            delete _errorThrottle.unknown_error;
        }

        var message = userMessageFor(n);
        var ui = options.ui || 'toast';

        if (ui === 'fullscreen' && options.container) {
            renderFullscreen(options.container, {
                title: options.title || 'Không thể tiếp tục',
                message: message,
                primaryLabel: options.primaryLabel,
                onPrimary: options.onPrimary,
                secondaryLabel: options.secondaryLabel,
                onSecondary: options.onSecondary,
            });
        } else if (ui === 'modal') {
            showErrorModal({
                title: options.title || 'Thông báo',
                message: message,
                primaryLabel: options.primaryLabel || 'Đóng',
                onPrimary: options.onPrimary,
                secondaryLabel: options.secondaryLabel,
                onSecondary: options.onSecondary,
            });
        } else {
            showToastError(message, options.durationMs);
        }
    }

    /** Màn hình lỗi tải dữ liệu — không log lần 2 (đã log lúc fetch). */
    function haShowFullscreenFromLastError(container, opts) {
        opts = opts || {};
        var le = global.__LAST_ERROR;
        var code = (le && le.code) || 'unknown_error';
        var dbg = (le && le.debug) || {};
        var needLogin = code === 'unauthorized' || code === 'missing_shop_context';
        var trialEnded = code === 'trial_expired';
        var slugMismatch =
            code === 'trial_slug_mismatch' || code === 'production_trial_prefix_forbidden';
        var backupMismatch =
            code === 'trial_backup_required' || code === 'production_backup_required';

        var defaultTitle = 'Không tải được dữ liệu';
        if (trialEnded) defaultTitle = 'Hết hạn dùng thử';
        else if (slugMismatch) defaultTitle = 'Cửa hàng và tài khoản chưa khớp';
        else if (backupMismatch) defaultTitle = 'Không truy cập được kho dữ liệu';

        var primaryLabel;
        var onPrimary;
        var secondaryLabel;
        var onSecondary;

        if (trialEnded) {
            primaryLabel = 'Nâng cấp ngay';
            onPrimary = function () {
                var t = window.top || window;
                try {
                    t.location.href = t.location.origin + '/upgrade';
                } catch (e) {
                    window.location.href = '/upgrade';
                }
            };
            secondaryLabel = 'Về trang chủ';
            onSecondary = function () {
                var t = window.top || window;
                try {
                    t.location.href = t.location.origin + '/';
                } catch (e) {
                    window.location.href = '/';
                }
            };
        } else if (slugMismatch || backupMismatch) {
            primaryLabel = 'Đăng nhập lại';
            onPrimary = function () {
                window.location.href = '/login';
            };
            secondaryLabel = 'Thử lại';
            onSecondary = function () {
                window.location.reload();
            };
        } else {
            primaryLabel = opts.primaryLabel !== undefined ? opts.primaryLabel : 'Thử lại';
            onPrimary = opts.onPrimary;
            secondaryLabel =
                opts.secondaryLabel !== undefined
                    ? opts.secondaryLabel
                    : needLogin
                      ? 'Đăng nhập lại'
                      : '';
            onSecondary =
                opts.onSecondary !== undefined
                    ? opts.onSecondary
                    : needLogin
                      ? function () {
                            window.location.href = '/login';
                        }
                      : undefined;
        }

        handleAppError(code, dbg, {
            skipLog: true,
            silent: false,
            ui: 'fullscreen',
            container: container,
            title: opts.title || defaultTitle,
            primaryLabel: primaryLabel,
            onPrimary: onPrimary,
            secondaryLabel: secondaryLabel,
            onSecondary: onSecondary,
        });
    }

    global.handleAppError = handleAppError;
    global.haParseSyncHttpError = haParseSyncHttpError;
    global.haUserMessageForAppError = userMessageFor;
    global.haRenderAppErrorFullscreen = renderFullscreen;
    global.haShowConfirmModal = haShowConfirmModal;
    global.haConfirmAsync = haConfirmAsync;
    global.haShowFullscreenFromLastError = haShowFullscreenFromLastError;
})(typeof window !== 'undefined' ? window : globalThis);
