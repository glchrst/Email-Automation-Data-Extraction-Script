// ==UserScript==
// @name         Invoice Management Quick Email Button
// @namespace    http://tampermonkey.net/
// @version      4.0
// @description  Add Quick Email button next to Reassign Hold button with formatted email templates
// @author       Gilchrist Isla
// @match        https://example-domain.com/invoices/details/*
// @grant        GM_setClipboard
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // ==================== CONSTANTS ====================
    const CONFIG = {
        BTN_ID: 'quick-email-btn',
        BTN_DEBOUNCE_MS: 300,
        SELECTORS: {
            invoiceNumber: 'span.h4',
            payeeName: 'span[ng-if="invoiceDetails.payeeName"]',
            poLink: 'a[href*="/purchaseorder/details/"]',
            supplierNumber: 'span[ng-if*="supplierNumber"]',
            payeeLink: 'a[href*="/payeemanagement/search"]',
            reassignButton: 'button',
            usernameLink: 'a[href*="/user-directory/"]',
            gridCell: '.ui-grid-cell-contents'
        },
        HOLD_TYPES: {
            NOT_RECEIVED: 'NOT_RECEIVED',
            PO_OVERBILLED: 'PO_OVERBILLED',
            GENERIC: 'GENERIC'
        },
        SYSTEMS: {
            SYSTEM_A: 'SYSTEM_A',
            SYSTEM_B: 'SYSTEM_B',
            UNKNOWN: 'UNKNOWN'
        },
        PO_PATTERNS: {
            systemA: /^[a-zA-Z0-9]{2}-[a-zA-Z0-9]{8}$/,
            systemB: /^[a-zA-Z0-9]{10}$/
        },
        HOLD_KEYWORDS: {
            NOT_RECEIVED: 'Items not Received in System',
            PO_OVERBILLED: 'Order Overbilled'
        },
        BROADCAST_LINKS: {
            systemA_receive: 'https://example-domain.com/help/receiving-items',
            systemA_addfunds: 'https://example-domain.com/help/add-funds',
            systemB_receive: 'https://example-domain.com/help/virtual-receipt',
            systemB_addfunds: 'https://example-domain.com/help/add-funds'
        },
        PROCUREMENT_URL: 'https://example-domain.com/procurement',
        EMAIL_SIGNATURE: 'User\nDepend Name | Department'
    };

    // ==================== LOGGING ====================
    const Logger = {
        prefix: '[Email Helper Script]',
        enabled: true,

        log: function(msg, data = null) {
            if (!this.enabled) return;
            console.log(`${this.prefix} ${msg}`, data || '');
        },

        warn: function(msg, data = null) {
            if (!this.enabled) return;
            console.warn(`${this.prefix} ⚠️ ${msg}`, data || '');
        },

        error: function(msg, data = null) {
            if (!this.enabled) return;
            console.error(`${this.prefix} ❌ ${msg}`, data || '');
        },

        debug: function(msg, data = null) {
            if (!this.enabled) return;
            console.debug(`${this.prefix} 🐛 ${msg}`, data || '');
        }
    };

    // ==================== VALIDATION ====================
    const Validator = {
        isNonEmpty: function(value) {
            return value && typeof value === 'string' && value.trim().length > 0;
        },

        validateEmailData: function(data) {
            const required = ['invoiceNumber', 'poNumber', 'payeeName', 'supplierNumber'];
            const missing = required.filter(key => !this.isNonEmpty(data[key]));

            if (missing.length > 0) {
                Logger.warn(`Missing required fields: ${missing.join(', ')}`);
                return { valid: false, missing };
            }

            Logger.log(`Email data validated successfully`, data);
            return { valid: true };
        },

        validateEmail: function(email) {
            const emailRegex = /^[^\s@]+@domain\.com$/;
            return emailRegex.test(email);
        }
    };

    // ==================== DOM EXTRACTOR ====================
    const DOMUtils = {
        findElementText: function(selector, fallbackSelector = null) {
            try {
                let element = document.querySelector(selector);
                if (element) {
                    Logger.debug(`Found element with selector: ${selector}`);
                    return element.textContent?.trim() || '';
                }

                if (fallbackSelector) {
                    Logger.debug(`Selector ${selector} failed, trying fallback`);
                    element = document.querySelector(fallbackSelector);
                    if (element) {
                        Logger.debug(`Found element with fallback selector: ${fallbackSelector}`);
                        return element.textContent?.trim() || '';
                    }
                }

                Logger.warn(`Could not find element with selector: ${selector}`);
                return '';
            } catch (e) {
                Logger.error(`Error finding element`, e);
                return '';
            }
        },

        findInnerText: function(selector) {
            try {
                const element = document.querySelector(selector);
                if (element) {
                    Logger.debug(`Found inner text with selector: ${selector}`);
                    return element.innerText?.trim() || '';
                }
                return '';
            } catch (e) {
                Logger.error(`Error finding inner text`, e);
                return '';
            }
        },

        findFirstElementByText: function(selector, searchText) {
            try {
                const elements = document.querySelectorAll(selector);
                for (const element of elements) {
                    if (element.textContent?.includes(searchText)) {
                        Logger.debug(`Found element containing: ${searchText}`);
                        return element;
                    }
                }
                Logger.warn(`No element found containing: ${searchText}`);
                return null;
            } catch (e) {
                Logger.error(`Error finding element by text`, e);
                return null;
            }
        }
    };

    // ==================== DATA EXTRACTION ====================
    function getInvoiceNumber() {
        try {
            const invoiceSpan = document.querySelector(CONFIG.SELECTORS.invoiceNumber);
            if (invoiceSpan) {
                const text = invoiceSpan.textContent?.trim() || '';
                const match = text.match(/Invoice #\s*(\S+)/);
                if (match && match[1]) {
                    Logger.log(`Extracted invoice number: ${match[1]}`);
                    return match[1];
                }
            }
            Logger.warn('Could not extract invoice number');
            return '';
        } catch (e) {
            Logger.error('Error extracting invoice number', e);
            return '';
        }
    }

    function getHoldType() {
        try {
            const gridCells = document.querySelectorAll(CONFIG.SELECTORS.gridCell);
            if (!gridCells.length) {
                Logger.warn('No grid cells found for hold type detection');
                return CONFIG.HOLD_TYPES.GENERIC;
            }

            for (const element of gridCells) {
                const text = element.textContent?.trim() || '';

                if (text === CONFIG.HOLD_KEYWORDS.NOT_RECEIVED) {
                    Logger.log('Detected hold type: NOT_RECEIVED');
                    return CONFIG.HOLD_TYPES.NOT_RECEIVED;
                }
                if (text === CONFIG.HOLD_KEYWORDS.PO_OVERBILLED) {
                    Logger.log('Detected hold type: PO_OVERBILLED');
                    return CONFIG.HOLD_TYPES.PO_OVERBILLED;
                }
            }

            Logger.log('No specific hold type detected, using GENERIC');
            return CONFIG.HOLD_TYPES.GENERIC;
        } catch (e) {
            Logger.error('Error detecting hold type', e);
            return CONFIG.HOLD_TYPES.GENERIC;
        }
    }

    function getPayeeName() {
        try {
            const payeeSpan = document.querySelector(CONFIG.SELECTORS.payeeName);
            if (payeeSpan) {
                const link = payeeSpan.querySelector(CONFIG.SELECTORS.payeeLink);
                if (link) {
                    const text = link.textContent?.trim() || '';
                    const payee = text.includes(':') ? text.split(':')[0] : text;
                    if (Validator.isNonEmpty(payee)) {
                        Logger.log(`Extracted payee name: ${payee}`);
                        return payee;
                    }
                }
            }
            Logger.warn('Could not extract payee name');
            return '';
        } catch (e) {
            Logger.error('Error extracting payee name', e);
            return '';
        }
    }

    function getPONumber() {
        try {
            const poLink = document.querySelector(CONFIG.SELECTORS.poLink);
            if (poLink) {
                const poNumber = poLink.textContent?.trim() || '';
                if (Validator.isNonEmpty(poNumber)) {
                    Logger.log(`Extracted PO number: ${poNumber}`);
                    return poNumber;
                }
            }
            Logger.warn('Could not extract PO number');
            return '';
        } catch (e) {
            Logger.error('Error extracting PO number', e);
            return '';
        }
    }

    function getSystemType() {
        try {
            const poNumber = getPONumber();
            if (!Validator.isNonEmpty(poNumber)) {
                Logger.warn('Cannot determine system type: no PO number');
                return CONFIG.SYSTEMS.UNKNOWN;
            }

            if (CONFIG.PO_PATTERNS.systemA.test(poNumber)) {
                Logger.log('Detected system type: SYSTEM_A');
                return CONFIG.SYSTEMS.SYSTEM_A;
            } else if (CONFIG.PO_PATTERNS.systemB.test(poNumber)) {
                Logger.log('Detected system type: SYSTEM_B');
                return CONFIG.SYSTEMS.SYSTEM_B;
            }

            Logger.warn(`System type not recognized for PO: ${poNumber}`);
            return CONFIG.SYSTEMS.UNKNOWN;
        } catch (e) {
            Logger.error('Error detecting system type', e);
            return CONFIG.SYSTEMS.UNKNOWN;
        }
    }

    function getSupplierNumber() {
        try {
            const supplierSpan = document.querySelector(CONFIG.SELECTORS.supplierNumber);
            if (supplierSpan) {
                const link = supplierSpan.querySelector(CONFIG.SELECTORS.payeeLink);
                if (link) {
                    const supplierNum = link.textContent?.trim() || '';
                    if (Validator.isNonEmpty(supplierNum)) {
                        Logger.log(`Extracted supplier number: ${supplierNum}`);
                        return supplierNum;
                    }
                }
            }
            Logger.warn('Could not extract supplier number');
            return '';
        } catch (e) {
            Logger.error('Error extracting supplier number', e);
            return '';
        }
    }

    function getUsername() {
        try {
            const userLink = document.querySelector(CONFIG.SELECTORS.usernameLink);
            if (userLink) {
                const username = userLink.textContent?.trim() || '';
                if (Validator.isNonEmpty(username)) {
                    Logger.log(`Extracted username: ${username}`);
                    return username;
                }
            }
            Logger.warn('Could not extract username');
            return '';
        } catch (e) {
            Logger.error('Error extracting username', e);
            return '';
        }
    }

    // ==================== EMAIL TEMPLATE BUILDER ====================
    const EmailTemplates = {
        // Template for NOT_RECEIVED holds
        notReceived: function(data, system) {
            const broadcastLink = system === CONFIG.SYSTEMS.SYSTEM_B
                ? CONFIG.BROADCAST_LINKS.systemB_receive
                : CONFIG.BROADCAST_LINKS.systemA_receive;

            const systemName = system === CONFIG.SYSTEMS.SYSTEM_B ? 'System B' : 'System A';
            const procurementLink = system === CONFIG.SYSTEMS.CLOUDFORGE
                ? CONFIG.BROADCAST_LINKS.cloudforge_receive
                : CONFIG.PROCUREMENT_URL;

            const instructions = system === CONFIG.SYSTEMS.SYSTEM_B
                ? `You can receive the items in System B by following this guide: ${CONFIG.BROADCAST_LINKS.systemB_receive}`
                : `Steps:\n1. Go to the System A Home Page ${CONFIG.PROCUREMENT_URL}\n2. Locate 'My Account' and then 'My Spend History'\n3. Click on the requisition Tab to find your Purchase Orders\n4. Scroll to the right (you may need to click the arrow to expand your view)\n5. Click on the receiving action\n6. Enter the date and amount to be received - Input the date of when you exactly receive the items\n7. Click 'Save' at the bottom of the screen\n8. Your Receipt will flow through and allow for payment to be released pending invoice receipt and payment terms.`;

            return {
                subject: `Invoice On Hold | Invoice No. ${data.invoiceNumber} | Case ID: | ${data.payeeName}`,
                body: `Hello XXX,

Good day and hope you are well!

Vendor has reached out to us through Payee Central regarding their invoice ${data.invoiceNumber}. Upon checking, invoice is currently on hold due to items not yet virtually received in ${systemName}. Kindly put this in your priorities as it is now past its due. Please see attached POD from vendor.

Name of Supplier: ${data.payeeName}
Supplier Number: ${data.supplierNumber}
Invoice Number: ${data.invoiceNumber}
PO Number: ${data.poNumber}
What is the Issue: Invoice is on hold due to mismatched quantities.
Action Needed: Kindly confirm if invoices are valid, if yes, kindly receive the items virtually in the system. Otherwise, please let me know.

${instructions}

Appreciate your immediate assistance/action on this.

Thank you so much and have a great day ahead!

Best regards,
${CONFIG.EMAIL_SIGNATURE}`
            };
        },

        // Template for PO_OVERBILLED holds
        poOverbilled: function(data, system) {
            const systemName = system === CONFIG.SYSTEMS.SYSTEM_B ? 'System B' : 'System A';

            const instructions = system === CONFIG.SYSTEMS.SYSTEM_B
                ? `You can either add funds to Order or provide an alternate Order to pay this invoice. Follow guide - ${CONFIG.BROADCAST_LINKS.systemB_addfunds}. If you are unable to add funds, please reach out to the System B team.`
                : `Adding funds to Order on ${systemName}:\n1. Go to the System A Home Page ${CONFIG.PROCUREMENT_URL}\n2. Locate 'Account Name' to the top right and click on 'Activity'.\n3. Click on "Orders" tab & click on "Advanced" button & select "Order#" from the dropdown\n4. Place the Order# and click on "Search"\n5. Go to Order line you wish to edit\n6. Check if Order is Received or Invoiced\n7. You may add funds by increasing quantity on quantity-based Orders.\nFor amount-based Orders, you may add by increasing price.\nIf you wish to increase price on quantity-based Orders, please add a new line.\n8. Scroll down and Click "Request Change"\n9. Edit the line or add a line\nClick on "Save Change Request"\n10. Change request will be routed to Approvers.\n*All required fields are marked.`;

            return {
                subject: `Add Funds | PO ${data.poNumber} | Case ID: | ${data.payeeName}`,
                body: `Hello XXX,

Good day. Hope you are well.

Vendor reached out to us regarding below outstanding invoice they need to submit under PO# ${data.poNumber} that has insufficient funds. Please see attached invoice copy.

Can you confirm if you will be adding funds to this PO for this request? Otherwise, please provide a new PO as soon as possible so vendor can bill their outstanding invoice.

Please assist with the following:
Name of Supplier: ${data.payeeName}
Supplier Number: ${data.supplierNumber}
Invoice Number: ${data.invoiceNumber}
PO Number: ${data.poNumber}
What is the Issue: PO has insufficient funds.
Action Needed: Kindly add funds to PO for invoice submission.

${instructions}

Appreciate your immediate assistance/action on this.

Thank you so much and have a great day ahead!

Best regards,
${CONFIG.EMAIL_SIGNATURE}`
            };
        },

        // Generic fallback template
        generic: function(data) {
            return {
                subject: `Invoice ${data.invoiceNumber} On Hold | ${data.payeeName}`,
                body: `Hi,

I'm following up regarding invoice ${data.invoiceNumber} which is currently on hold.

Best regards,
${CONFIG.EMAIL_SIGNATURE}`
            };
        }
    };

    function createEmailContent(holdType) {
        try {
            const data = {
                payeeName: getPayeeName(),
                poNumber: getPONumber(),
                invoiceNumber: getInvoiceNumber(),
                supplierNumber: getSupplierNumber()
            };

            // Validate data before creating email
            const validation = Validator.validateEmailData(data);
            if (!validation.valid) {
                Logger.error(`Cannot create email: missing fields`, validation.missing);
                throw new Error(`Missing required fields: ${validation.missing.join(', ')}`);
            }

            const system = getSystemType();
            Logger.log(`Creating email with hold type: ${holdType}, system: ${system}`);

            switch(holdType) {
                case CONFIG.HOLD_TYPES.NOT_RECEIVED:
                    return EmailTemplates.notReceived(data, system);
                case CONFIG.HOLD_TYPES.PO_OVERBILLED:
                    return EmailTemplates.poOverbilled(data, system);
                default:
                    return EmailTemplates.generic(data);
            }
        } catch (e) {
            Logger.error('Error creating email content', e);
            throw e;
        }
    }

    // ==================== UI UTILITIES ====================
    const UIUtils = {
        showNotification: function(message, type = 'info', duration = 3000) {
            const notification = document.createElement('div');
            notification.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                padding: 12px 16px;
                border-radius: 4px;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto;
                font-size: 14px;
                z-index: 999999;
                box-shadow: 0 2px 8px rgba(0,0,0,0.15);
            `;

            const colors = {
                'info': { bg: '#0073e6', color: '#fff' },
                'success': { bg: '#28a745', color: '#fff' },
                'warning': { bg: '#ff9800', color: '#fff' },
                'error': { bg: '#dc3545', color: '#fff' }
            };

            const style = colors[type] || colors['info'];
            notification.style.background = style.bg;
            notification.style.color = style.color;
            notification.textContent = message;

            document.body.appendChild(notification);

            setTimeout(() => {
                notification.remove();
            }, duration);

            Logger.log(`Notification (${type}): ${message}`);
        }
    };

    // ==================== BUTTON CREATION ====================
    function createQuickEmailButton(reassignButton) {
        if (!reassignButton) {
            Logger.error('Cannot create email button: reassign button not found');
            return null;
        }

        try {
            const emailButton = document.createElement('button');
            emailButton.id = CONFIG.BTN_ID;
            emailButton.textContent = 'Quick Email';
            emailButton.type = 'button';

            emailButton.className = reassignButton.className;
            const styles = window.getComputedStyle(reassignButton);

            emailButton.style.cssText = `
                background-color: ${styles.backgroundColor} !important;
                color: ${styles.color} !important;
                border: ${styles.border} !important;
                padding: ${styles.padding} !important;
                border-radius: ${styles.borderRadius} !important;
                font-family: ${styles.fontFamily} !important;
                margin-left: 8px !important;
                cursor: pointer !important;
                transition: all 0.2s ease !important;
            `;

            // Add hover effect
            emailButton.addEventListener('mouseenter', () => {
                emailButton.style.opacity = '0.8';
            });

            emailButton.addEventListener('mouseleave', () => {
                emailButton.style.opacity = '1';
            });

            Logger.log('Email button created successfully');
            return emailButton;
        } catch (e) {
            Logger.error('Error creating email button', e);
            return null;
        }
    }

    // ==================== BUTTON EVENT HANDLER ====================
    function handleEmailButtonClick(e) {
        e.preventDefault();
        Logger.log('Email button clicked');

        try {
            const username = getUsername();
            if (!Validator.isNonEmpty(username)) {
                Logger.warn('Username not found, opening user directory');
                UIUtils.showNotification('Could not find username. Opening user directory...', 'warning', 5000);
                window.open('https://example-domain.com/user-directory/', '_blank');
                return;
            }

            const email = `${username}@domain.com`;
            if (!Validator.validateEmail(email)) {
                Logger.error(`Invalid email format: ${email}`);
                UIUtils.showNotification('Invalid email address detected', 'error');
                return;
            }

            const holdType = getHoldType();
            Logger.log(`Creating email for hold type: ${holdType}`);

            const emailContent = createEmailContent(holdType);

            // Safe clipboard copy with error handling
            try {
                GM_setClipboard(emailContent.body, 'text/plain');
                Logger.log('Email content copied to clipboard');
            } catch (clipboardError) {
                Logger.warn('Clipboard copy failed', clipboardError);
                // Continue anyway - mailto will still work
            }

            // Safely encode and open mailto
            const subject = encodeURIComponent(emailContent.subject);
            const body = encodeURIComponent(emailContent.body);
            const mailtoUrl = `mailto:${email}?subject=${subject}&body=${body}`;

            Logger.log(`Opening mailto: ${email}`);
            window.location.href = mailtoUrl;

            UIUtils.showNotification(`Email opened for ${email}`, 'success');
        } catch (e) {
            Logger.error('Error handling email button click', e);
            UIUtils.showNotification(`Error: ${e.message}`, 'error', 5000);
        }
    }

    // ==================== BUTTON INJECTION ====================
    function setupEmailButton() {
        if (document.getElementById(CONFIG.BTN_ID)) {
            Logger.debug('Email button already exists');
            return;
        }

        try {
            const buttons = Array.from(document.querySelectorAll(CONFIG.SELECTORS.reassignButton));
            const reassignButton = buttons.find(button =>
                button.textContent?.includes('Reassign Hold')
            );

            if (!reassignButton) {
                Logger.debug('Reassign Hold button not found');
                return;
            }

            Logger.log('Found Reassign Hold button');

            const emailButton = createQuickEmailButton(reassignButton);
            if (!emailButton) {
                Logger.error('Failed to create email button');
                return;
            }

            emailButton.addEventListener('click', handleEmailButtonClick);

            if (reassignButton.parentNode) {
                reassignButton.parentNode.insertBefore(emailButton, reassignButton.nextSibling);
                Logger.log('Email button injected successfully');
            } else {
                Logger.error('Cannot inject button: parent node not found');
            }
        } catch (e) {
            Logger.error('Error setting up email button', e);
        }
    }

    // ==================== OBSERVER MANAGEMENT ====================
    const ObserverManager = {
        observer: null,
        debounceTimer: null,

        initialize: function() {
            try {
                const debounceMs = CONFIG.BTN_DEBOUNCE_MS;
                this.observer = new MutationObserver(() => {
                    clearTimeout(this.debounceTimer);
                    this.debounceTimer = setTimeout(() => {
                        if (!document.getElementById(CONFIG.BTN_ID)) {
                            setupEmailButton();
                        }
                    }, debounceMs);
                });

                this.observer.observe(document.body, {
                    childList: true,
                    subtree: true
                });

                Logger.log('MutationObserver initialized');
            } catch (e) {
                Logger.error('Error initializing observer', e);
            }
        },

        cleanup: function() {
            try {
                if (this.observer) {
                    this.observer.disconnect();
                    this.observer = null;
                    Logger.log('MutationObserver disconnected');
                }
                if (this.debounceTimer) {
                    clearTimeout(this.debounceTimer);
                    this.debounceTimer = null;
                    Logger.log('Debounce timer cleared');
                }
            } catch (e) {
                Logger.error('Error during cleanup', e);
            }
        }
    };

    // ==================== INITIALIZATION ====================
    function initialize() {
        try {
            Logger.log('Script initialization started');

            // Setup button on page load
            if (document.readyState === 'complete' || document.readyState === 'interactive') {
                setupEmailButton();
            } else {
                window.addEventListener('load', setupEmailButton);
            }

            // Initialize observer for dynamic content
            ObserverManager.initialize();

            // Cleanup on navigation/unload
            window.addEventListener('beforeunload', () => {
                ObserverManager.cleanup();
            });

            Logger.log('Script initialization completed successfully');
        } catch (e) {
            Logger.error('Fatal error during initialization', e);
        }
    }

    // Start the script
    initialize();
})();