// For handling HyperProc errors:
export default class HyperProcError extends Error {
  
    // CONSTRUCTOR :: STRING, {op:SYMBOL, id?:STRING, state?:OBJECT, cause?:Error} -> this
    constructor(message, { op, id, state, cause } = {}) {    // Use native cause for stack chaining where supported
        
        super(message, cause ? { cause } : undefined);
        this.name = "HyperProcError";
        this.op = String(op ?? "UNDEFINED");   
        this.id = id;

        // Avoid dumping full state in JSON/logs by default:
        if (state !== undefined) {
            Object.defineProperty(this, "state", {
                value: state, writable: false, enumerable: false, configurable: false
            });
        }

        
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, HyperProcError);
        }

        // Ensure original stack is visible even if runtime ignores `cause`
        if (cause?.stack && this.stack) {
            this.stack = `${this.stack}\nCaused by: ${cause.stack}`;
        }

    }

    /**
     * 
     *  Instance Methods 
     * 
     */

    // :: VOID -> JSON
    // Returns error as JSON:
    toJSON() {
        return {
            name: this.name,
            message: this.message,
            op: this.op,
            id: this.id,
            cause: this.cause ? { name: this.cause.name, message: this.cause.message } : undefined
        };
    }

    /**
     *
     *  Static Methods
     * 
     */

    // Static Factory Method :: STRING, {op, id, state, cause} -> HyperProcError
    static init(message, opts) {
        return new HyperProcError(message, opts);
    }

    // :: ERROR, {op, id, state} -> HyperProcError
    // Initalizes hyperProc Error from an existing error:
    static from(err, { op, id, state } = {}) {
        return new HyperProcError(err?.message ?? String(err), { op, id, state, cause: err });
    }

}
