// Dependencies:
import HyperProcError from "./HyperProcError/index.js";

// Implements a chainable process for managing explicit state with 
export default class HyperProc {

    /* Static Fields */
    static APPLY_TO = Symbol("APPLY_TO");   // Signifies an operation applied to state
    static TRANSFORM = Symbol("TRANSFORM"); // Signifies an operation for writing a new value to an existing property of state
    static AUGMENT = Symbol("AUGMENT");     // Signifies an operation that adds a new property to state
    static CHAIN = Symbol("CHAIN");         // Signifies an operation that calls another "hyperProc" instance
    static NOOP = Symbol("NOOP");           // Signifies an operation that does not change state 

    // CONSTRUCTOR :: OBJECT -> this
    constructor(env = {}) {
        this._env = env;                         // Additional functions, classes, and constants we can apply to functions to change with state
        this._ops = [] ;                         // What to apply to state
        this._onError = (err, state, env) => {   // Default error handling function
            console.error(err)  
            return state;
        } 
    }

    /**
     * 
     *  Instance Methods 
     * 
     */

    // :: (value, state, env) -> PROMISE(STATE) -> this
    // Applies function to state:
    applyTo(fn) {
        const op = HyperProc.APPLY_TO;
        this._ops.push({fn, op});
        return this;
    }

    // :: STRING, (value, state, env) -> PROMISE(VALUE) -> this
    // Applies function to a specific property of state
    transform(id, fn) {
        const op = HyperProc.TRANSFORM;
        this._ops.push({id, fn, op})
        return this;
    }

    // :: STRING, (state, env) -> PROMISE(VALUE) -> this
    // Writes result of function to new property of state:
    // NOTE: This intent here is to add a new property to state
    augment(id, fn) {
        const op = HyperProc.AUGMENT;
        this._ops.push({id, fn, op})
        return this;
    }

    // :: (state, env) -> PROMISE(STATE)
    // Runs function but returns state unchanged:
    noop(fn) {
        const op = HyperProc.NOOP;
        this._ops.push({fn, op})
        return this;
    }

    // :: (state, env -> PROMISE(STRING)) -> this
    // :: STRING -> this
    // Helper method for writing messages to console:
    log(arg) {
        const op = HyperProc.NOOP;
        const fn = typeof(arg) === "function"
            ? async (state, env) => console.log(await arg(state,env))
            : () => console.log(arg)
        this._ops.push({fn, op})
        return this;
    }

    // :: (err, state, env) -> PROMISE(state)
    // Sets "on error" function to handle errors thrown when "run" is called:
    onError(fn) {
        this._onError = fn;
        return this;
    }

    // :: hyperProc -> this
    // Combines "this" hyperProc instance with another hyperproc instance:
    chain(hyperProc) {
        if (!(hyperProc instanceof HyperProc)) {
            throw new TypeError("Can only chain to an instance of HyperProc");
        }
        const op = HyperProc.CHAIN;
        const fn = hyperProc;
        this._ops.push({fn, op});
        return this;
    }

    // :: OBJECT -> PROMISE(OBJECT)
    // Applies stored operations to given state:
    // WARNING: Any operation applied to state will mutate the given OBJECT:
    async run(state) {
        // Ensure state is something hyperProc can operate on:
        if (!this.constructor.isState(state)) {        
            throw new TypeError("HyperProc.run expects an OBJECT as state");
        }
        // For passing info to errors:
        let spec = {};
        // For checking state before assigning it:
        let nextState;
        try {
            for (const {id, fn, op} of this._ops) {
                spec = {id, op};
                switch(op) {
                    case HyperProc.APPLY_TO:
                        nextState = await fn(state, this._env);
                        if (!this.constructor.isState(nextState)) {        
                            throw new TypeError("HyperProc.applyTo must return an OBJECT as state");
                        }
                        state = nextState;
                    break;
                    case HyperProc.TRANSFORM:
                        if (!Object.prototype.hasOwnProperty.call(state, id)) {
                            throw new HyperProcError(`HyperProc.transform missing property "${id}"`, { id, op });
                        }
                        state[id] = await fn(state[id], state, this._env);
                    break;
                    case HyperProc.AUGMENT:
                        if (Object.prototype.hasOwnProperty.call(state, id)) {
                            throw new HyperProcError(`HyperProc.augment property "${id}" already exists`, { id, op });
                        }
                        state[id] = await fn(state, this._env);
                    break;
                    case HyperProc.CHAIN:
                        nextState = await fn.run(state);
                        if (!this.constructor.isState(nextState)) {        
                            throw new TypeError("HyperProc.chain must return an OBJECT as state");
                        }
                        state = nextState;
                    break;
                    case HyperProc.NOOP:
                        await fn(state, this._env);
                    break;
                    default:
                        throw new HyperProcError(`Unknown Operation: ${String(op)}`, {state, id, op})
                }   
            }
        } catch (err) {
            // Normalize error:
            const hyperProcError = err instanceof HyperProcError
                ? err 
                : HyperProcError.from(err, {state, ...spec});
            // When running onError, we need to catch any possible errors that may "bubble up" from other ops:
            try {
                const result = await this._onError(hyperProcError, state, this._env);
                state = result === undefined ? state : result
                if (!this.constructor.isState(state)) {        
                    throw new TypeError("HyperProc.onError must return UNDEFINED or an OBJECT as state");
                }
            } catch (rethrow) {
                throw rethrow;
            }
        } 
        return state;
    }

    /**
     * 
     * Static Methods
     * 
     */

    // Static Factory Method :: OBJECT -> hyperProc
    static init(env) {
        return new this(env);
    }

    // :: * -> BOOL
    // Return BOOL for if value can be used as "state" for hyperProc to operate on:
    static isState(value) {
        if (value !== null && typeof value === "object" && !Array.isArray(value)) {
            const proto = Object.getPrototypeOf(value);
            return proto === Object.prototype || proto === null; // plain object only
        }
        return false;
    }

}