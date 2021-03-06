import 'url-search-params-polyfill';
import {Console} from "./console";
import rest from "@openremote/rest";
import {AxiosRequestConfig} from 'axios';
import {EventProvider, EventProviderStatus, WebSocketEventProvider} from "./event";

export enum ORError {
    NONE = "NONE",
    MANAGER_FAILED_TO_LOAD = "MANAGER_FAILED_TO_LOAD",
    KEYCLOAK_FAILED_TO_LOAD = "KEYCLOAK_FAILED_TO_LOAD",
    AUTH_TYPE_UNSUPPORTED = "AUTH_TYPE_UNSUPPORTED",
    CONSOLE_ERROR = "CONSOLE_INIT_ERROR",
    EVENTS_CONNECTION_ERROR = "EVENTS_CONNECTION_ERROR"
}

export enum Auth {
    KEYCLOAK = "KEYCLOAK",
    BASIC = "BASIC",
    NONE = "NONE"
}

export enum OREvent {
    INIT = "INIT",
    AUTHENTICATED = "AUTHENTICATED",
    ERROR = "ERROR",
    READY = "READY",
    CONSOLE_INIT = "CONSOLE_INIT",
    CONSOLE_READY = "CONSOLE_READY",
    EVENTS_CONNECTED = "EVENTS_CONNECTED",
    EVENTS_CONNECTING = "EVENTS_CONNECTING",
    EVENTS_DISCONNECTED = "EVENTS_DISCONNECTED",
}

export enum EventProviderType {
    WEBSOCKET = "WEBSOCKET",
    POLLING = "POLLING"
}

export interface Credentials {
    username: string;
    password: string;
}

export interface LoginOptions {
    redirectUrl?: string;
    credentials?: Credentials;
}

export interface ManagerConfig {
    managerUrl: string;
    keycloakUrl?: string;
    appVersion?: string;
    auth?: Auth;
    realm: string;
    autoLogin?: boolean;
    credentials?: Credentials;
    consoleAutoEnable?: boolean;
    eventProviderType?: EventProviderType;
    pollingIntervalMillis?: number;
}

export type EventCallback = (event: OREvent) => any;

export class Manager {

    get username() {
        return this._username;
    }

    get error() {
        return this._error;
    }

    get authenticated() {
        return this._authenticated;
    }

    get initialised() {
        return this._config != null;
    }

    get ready() {
        return this._ready;
    }

    get config() {
        return this._config;
    }

    get roles() {
        return this._roles;
    }

    get managerVersion() {
        return this._managerVersion;
    }

    get isManagerAvailable() {
        return this._managerVersion && this._managerVersion !== "";
    }

    get isError() {
        return this._error != null && this._error !== ORError.NONE;
    }

    get connectionStatus() {
        return this._events && this._events.status;
    }

    get console() {
        return this._console;
    }

    get events() {
        return this._events;
    }

    protected static normaliseConfig(config: ManagerConfig): ManagerConfig {
        const normalisedConfig: ManagerConfig = Object.assign({}, config);

        if (!normalisedConfig.managerUrl || normalisedConfig.managerUrl === "") {
            // Assume manager is running on same host as this code
            normalisedConfig.managerUrl = window.location.protocol + "//" + window.location.hostname + ":" + window.location.port;
        } else {
            // Normalise by stripping any trailing slashes
            normalisedConfig.managerUrl = normalisedConfig.managerUrl.replace(/\/+$/, "");
        }

        if (!normalisedConfig.realm || normalisedConfig.realm === "") {
            // Assume master realm
            normalisedConfig.realm = "master";
        }

        if (normalisedConfig.auth === Auth.KEYCLOAK) {
            // Determine URL of keycloak server
            if (!normalisedConfig.keycloakUrl || normalisedConfig.keycloakUrl === "") {
                // Assume keycloak is running on same host as the manager
                normalisedConfig.keycloakUrl = normalisedConfig.managerUrl + "/auth";
            } else {
                // Normalise by stripping any trailing slashes
                normalisedConfig.keycloakUrl = normalisedConfig.keycloakUrl.replace(/\/+$/, "");
            }
        }

        if (normalisedConfig.consoleAutoEnable === undefined) {
            normalisedConfig.consoleAutoEnable = true;
        }

        if (!normalisedConfig.eventProviderType) {
            normalisedConfig.eventProviderType = EventProviderType.WEBSOCKET;
        }

        if (!normalisedConfig.pollingIntervalMillis || normalisedConfig.pollingIntervalMillis < 5000) {
            normalisedConfig.pollingIntervalMillis = 10000;
        }

        return normalisedConfig;
    }

    private _error: ORError = ORError.NONE;
    private _config!: ManagerConfig;
    private _authenticated: boolean = false;
    private _ready: boolean = false;
    private _name: string = "";
    private _username: string = "";
    private _keycloak: any = null;
    private _roles: string[] = [];
    private _keycloakUpdateTokenInterval?: number = undefined;
    private _managerVersion: string = "";
    private _listeners: EventCallback[] = [];
    private _console!: Console;
    private _events: EventProvider | null = null;

    public isManagerSameOrigin(): boolean {
        if (!this.initialised) {
            return false;
        }

        const managerUrl = new URL(this._config.managerUrl);
        const windowUrl = window.location;
        return managerUrl.protocol === windowUrl.protocol
            && managerUrl.hostname === windowUrl.hostname
            && managerUrl.port === windowUrl.port;
    }

    public addListener(callback: EventCallback) {
        const index = this._listeners.indexOf(callback);
        if (index < 0) {
            this._listeners.push(callback);
        }
    }

    public removeListener(callback: EventCallback) {
        const index = this._listeners.indexOf(callback);
        if (index >= 0) {
            this._listeners.splice(index, 1);
        }
    }

    public async init(config: ManagerConfig): Promise<boolean> {
        if (this._config) {
            console.log("Already initialised");
        }

        this._config = Manager.normaliseConfig(config);
        let success = await this.doInit();

        if (success) {
            success = this.doRestApiInit();
        }

        if (success) {
            success = await this.doConsoleInit();
        }

        if (success) {
            success = await this.doAuthInit();
        }

        // TODO: Reinstate this once websocket supports anonymous connections
        // if (success) {
        //     success = await this.doEventsSubscriptionInit();
        // }

        if (success) {
            this._ready = true;
            this._emitEvent(OREvent.READY);
        }

        return success;
    }

    protected async doInit(): Promise<boolean> {
        // Check manager exists by calling the info endpoint
        try {
            const json = await new Promise<any>((resolve, reject) => {
                const oReq = new XMLHttpRequest();
                oReq.addEventListener("load", () => {
                    resolve(JSON.parse(oReq.responseText));
                });
                oReq.addEventListener("error", () => {
                    reject(new Error("Failed to contact the manager"));
                });
                oReq.open("GET", this._config.managerUrl + "/api/master/info");
                oReq.send();
            });
            this._managerVersion = json && json.version ? json.version : "";
            return true;
        } catch (e) {
            // TODO: Implement auto retry?
            console.error("Failed to contact the manager", e);
            this._setError(ORError.MANAGER_FAILED_TO_LOAD);
            return false;
        }
    }

    protected async doAuthInit(): Promise<boolean> {
        let success = true;
        switch (this._config.auth) {
            case Auth.BASIC:
                // TODO: Implement Basic auth support
                if (this._config.credentials) {
                    rest.setBasicAuth(this._config.credentials.username, this._config.credentials.password);
                }
                this._setError(ORError.AUTH_TYPE_UNSUPPORTED);
                success = false;
                break;
            case Auth.KEYCLOAK:
                success = await this.loadAndInitialiseKeycloak();
                // Add interceptor to inject authorization header on each request
                rest.addRequestInterceptor(
                    (config: AxiosRequestConfig) => {
                        if (!config.headers.Authorization) {
                            const token = this.getKeycloakToken();

                            if (token) {
                                config.headers.Authorization = "Bearer " + token;
                            }
                        }

                        return config;
                    }
                );
                break;
            case Auth.NONE:
                // Nothing for us to do here
                break;
            default:
                this._setError(ORError.AUTH_TYPE_UNSUPPORTED);
                success = false;
                break;
        }

        return success;
    }

    protected doRestApiInit(): boolean {
        rest.setTimeout(10000);
        rest.initialise(this.getApiBaseUrl());
        return true;
    }

    protected async doEventsSubscriptionInit(): Promise<boolean> {
        let connected = false;

        switch (this._config.eventProviderType) {
            case EventProviderType.WEBSOCKET:
                this._events = new WebSocketEventProvider(this._config.managerUrl, (status: EventProviderStatus) => {this.onEventsProviderStatusChanged(status)});
                connected = await this._events.connect();
                break;
            case EventProviderType.POLLING:
                break;
        }

        if (!connected) {
            this._setError(ORError.EVENTS_CONNECTION_ERROR);
        }

        return connected;
    }

    protected onEventsProviderStatusChanged(status: EventProviderStatus) {
        switch (status) {
            case EventProviderStatus.DISCONNECTED:
                this._emitEvent(OREvent.EVENTS_DISCONNECTED);
                break;
            case EventProviderStatus.CONNECTED:
                this._emitEvent(OREvent.EVENTS_CONNECTED);
                break;
            case EventProviderStatus.CONNECTING:
                this._emitEvent(OREvent.EVENTS_CONNECTING);
                break;
        }
    }

    protected async doConsoleInit(): Promise<boolean> {
        try {
            let orConsole = new Console(this._config.realm, this._config.consoleAutoEnable!, () => {
                this._emitEvent(OREvent.CONSOLE_READY);
            });

            this._console = orConsole;

            await orConsole.initialise();
            this._emitEvent(OREvent.CONSOLE_INIT);
            return true;
        } catch (e) {
            this._setError(ORError.CONSOLE_ERROR);
            return false;
        }
    }

    public logout(redirectUrl?: string) {
        if (this._keycloak) {
            if (this.console.isMobile) {
                this.console.storeData("REFRESH_TOKEN", null);
            }
            const options = redirectUrl && redirectUrl !== "" ? {redirectUri: redirectUrl} : null;
            this._keycloak.logout(options);
        }
    }

    public login(options?: LoginOptions) {
        if (!this.initialised) {
            return;
        }
        switch (this._config.auth) {
            case Auth.BASIC:
                if (options && options.credentials) {
                    this._config.credentials = Object.assign({}, options.credentials);
                }
                const username = this._config.credentials ? this._config.credentials.username : null;
                const password = this._config.credentials ? this._config.credentials.password : null;

                if (username && password && username !== "" && password !== "") {
                    // TODO: Perform some request to check basic auth credentials
                    this._setAuthenticated(true);
                }
                break;
            case Auth.KEYCLOAK:
                if (this._keycloak) {
                    const keycloakOptions: any = {};
                    if (options && options.redirectUrl && options.redirectUrl !== "") {
                        keycloakOptions.redirectUri = options.redirectUrl;
                    }
                    if (this.isMobile()) {
                        keycloakOptions.scope = "offline_access";
                    }
                    this._keycloak.login(keycloakOptions);
                }
                break;
            case Auth.NONE:
                break;
        }
    }

    public isSuperUser() {
        return this.hasRole("admin");
    }

    public getApiBaseUrl() {
        let baseUrl = this._config.managerUrl;
        baseUrl += "/api/" + this._config.realm + "/";
        return baseUrl;
    }

    public getAppName(): string {
        let pathArr = location.pathname.split('/');
        return pathArr.length >= 1 ? pathArr[1] : "";
    }

    public hasRole(role: string) {
        return this._roles && this._roles.indexOf(role) >= 0;
    }

    public getAuthorizationHeader(): string | undefined {
        if (this._keycloak && this.authenticated) {
            return "Bearer " + this._keycloak.token;
        }

        return undefined;
    }

    public getKeycloakToken(): string | undefined {
        if (this._keycloak && this.authenticated) {
            return this._keycloak.token;
        }
        return undefined;
    }

    public getRealm(): string | undefined {
        if (this._config) {
            return this._config.realm;
        }
        return undefined;
    }

    protected isMobile(): boolean {
        return this.console && this.console.isMobile;
    }

    protected _onAuthenticated() {
        // If native shell is enabled, we need an offline refresh token
        if (this.console && this.console.isMobile && this.config.auth === Auth.KEYCLOAK) {

            if (this._keycloak.refreshTokenParsed.typ === "Offline") {
                console.debug("Storing offline refresh token");
                this.console.storeData("REFRESH_TOKEN", this._keycloak.refreshToken);
            } else {
                this.login();
            }
        }
    }

    // NOTE: The below works with Keycloak 2.x JS API - They made breaking changes in newer versions
    // so this will need updating.
    protected async loadAndInitialiseKeycloak(): Promise<boolean> {

        // Load the keycloak JS API
        const promise = new Promise<Event>((resolve, reject) => {
            // Load keycloak script from keycloak server
            const scriptElement = document.createElement("script");
            scriptElement.src = this._config.keycloakUrl + "/js/keycloak.js";
            scriptElement.onload = (e) => resolve(e);
            scriptElement.onerror = (e) => reject(e);
            document.querySelector("head")!.appendChild(scriptElement);
        });

        try {
            await promise;

            // Should have Keycloak global var now
            if (!(window as any).Keycloak) {
                this._setError(ORError.KEYCLOAK_FAILED_TO_LOAD);
                return false;
            }

            // Initialise keycloak
            this._keycloak = (window as any).Keycloak({
                clientId: "openremote",
                realm: this._config.realm,
                url: this._config.keycloakUrl
            });

            this._keycloak.onAuthSuccess = () => {
                if (keycloakPromise) {
                    keycloakPromise(true);
                }
            };

            this._keycloak.onAuthError = () => {
                this._setAuthenticated(false);
            };

            // There's a bug in some Keycloak versions which means the init promise doesn't resolve
            // so putting a check in place; wrap keycloak promise in proper ES6 promise
            let keycloakPromise: any = null;
            try {
                // Try to use a stored offline refresh token if defined
                const offlineToken = await this._getNativeOfflineRefreshToken();

                const authenticated = await new Promise<boolean>(((resolve, reject) => {
                    keycloakPromise = resolve;
                    this._keycloak.init({
                        checkLoginIframe: false, // Doesn't work well with offline tokens or periodic token updates
                        onLoad: this._config.autoLogin ? "login-required" : "check-sso",
                        refreshToken: offlineToken
                    }).success((auth: boolean) => {
                        resolve(auth);
                    }).error(() => {
                        reject();
                    });
                }));

                keycloakPromise = null;

                if (authenticated) {

                    this._name = this._keycloak.tokenParsed.name;
                    this._username = this._keycloak.tokenParsed.preferred_username;
                    this._roles = this._keycloak.realmAccess.roles;

                    // Update the access token every 10s (note keycloak will only update if expiring within configured
                    // time period.
                    if (this._keycloakUpdateTokenInterval) {
                        clearInterval(this._keycloakUpdateTokenInterval);
                        delete this._keycloakUpdateTokenInterval;
                    }
                    this._keycloakUpdateTokenInterval = window.setInterval(() => {
                        this.updateKeycloakAccessToken();
                    }, 10000);
                    this._onAuthenticated();
                }
                this._setAuthenticated(authenticated);
                return true;
            } catch (e) {
                console.error(e);
                keycloakPromise = null;
                this._setAuthenticated(false);
                return false;
            }
        } catch (error) {
            this._setError(ORError.KEYCLOAK_FAILED_TO_LOAD);
            return false;
        }
    }

    protected updateKeycloakAccessToken(): Promise<boolean> {
        // Access token must be good for X more seconds, should be half of Constants.ACCESS_TOKEN_LIFESPAN_SECONDS
        return new Promise<boolean>(() => {
            this._keycloak.updateToken(30)
                .success((tokenRefreshed: boolean) => {
                    // If refreshed from server, it means the refresh token was still good for another access token
                    console.debug("Access token update success, refreshed from server: " + tokenRefreshed);
                    return tokenRefreshed;
                })
                .error(() => {
                    // Refresh token expired (either SSO max session duration or offline idle timeout), see
                    // IDENTITY_SESSION_MAX_MINUTES and IDENTITY_SESSION_OFFLINE_TIMEOUT_MINUTES server config
                    console.info("Access token update failed, refresh token expired, login required");
                    this._keycloak.clearToken();
                    this._keycloak.login();
                });
        });
    }

    protected async _getNativeOfflineRefreshToken(): Promise<string | null> {
        if (this.console && this.console.isMobile) {
            return await this.console.retrieveData("REFRESH_TOKEN");
        }
        return null;
    }

    protected _emitEvent(event: OREvent) {
        window.setTimeout(() => {
            for (const listener of this._listeners) {
                listener(event);
            }
        }, 0);
    }

    protected _setError(error: ORError) {
        this._error = error;
        this._emitEvent(OREvent.ERROR);
    }

    // TODO: Remove events logic once websocket supports anonymous connections
    protected _setAuthenticated(authenticated: boolean) {
        this._authenticated = authenticated;
        if (authenticated) {
            this._emitEvent(OREvent.AUTHENTICATED);
            if (!this._events) {
                this.doEventsSubscriptionInit();
            }
        } else {
            if (this._events != null) {
                this._events.disconnect();
            }
            this._events = null;
        }
    }
}

export default new Manager();
