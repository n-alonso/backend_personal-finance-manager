const e = require('express')
const pool = require('../models/db_config')

// Utility Queries
const doesIdExist = async (req, res, next) => {
    const table = req.originalUrl.split('/')[1]
    const id = req.params.id

    pool.query(`
        SELECT * FROM ${table}
        WHERE id = $1;
    `, [id], (error, response) => {
        if (error) {
            next(error)
        } else if (response.rows.length === 0) {
            let err = new Error(
                "Bad request. '" + table + "' with 'id: " + id + "' not found."
            )
            err.code = 404
            err.public = true
            next(err)
        } else {
            next()
        }
    }) 
}

const doesSalaryExist = (req, res, next) => {
    pool.query(`
        SELECT COUNT(*) FROM salary;
    `, (error, results) => {
        if (error) {
            next(error)
        } else if (results.rows[0].count > 0) {
            let err = new Error(
                "'Bad request. Salary.amount' is already set, please use 'PUT /salary' to update it instead."
            )
            err.code = 400
            err.public = true
            next(err)
        } else {
            next()
        }
    })
}

const doesEnvelopeExist = (req, res, next) => {
    const name = req.body.name

    pool.query(`
        SELECT COUNT(*) FROM envelopes
        WHERE name = $1;
    `, [name], (error, results) => {
        if (error) {
            next(error)
        } else if (results.rows[0].count > 0) {
            let err = new Error(
                `Bad request. An 'envelope' with 'name: ${name}' already exists.`
            )
            err.code = 400
            err.public = true
            next(err)
        } else {
            next()
        }
    })
}

const validateSumOfAllEnvelopesVsSalary = async (req, endpoint) => {

    let sum;
    if (endpoint === 'envelopes') {
        if (req.method === 'POST') {
            pool.query(`SELECT SUM(spending_limit) FROM envelopes;`, (error, results) => {
                if (error) {
                    throw error
                } else {
                    const queryResult = Number(results.rows[0].sum)
                    const inputLimit = req.body.spending_limit
                    sum = queryResult + inputLimit
                }
            })
        }
        if (req.method === 'PUT') {
            console.log('put')
            Promise.all([
                pool.query(`SELECT SUM(spending_limit) FROM envelopes;`),
                pool.query(`SELECT spending_limit FROM envelopes WHERE name = ${req.body.name};`)
            ])
                .then(([envelopesResponse, envelopeResponse]) => {
                    const envelopesQueryResult = Number(envelopesResponse.rows[0].sum)
                    const singleEnvelopeQueryResult = Number(envelopeResponse.rows[0].spending_limit)
                    sum = envelopesQueryResult + (Math.abs(singleEnvelopeQueryResult - req.body.spending_limit))
                })
        }
    }

    const results = await Promise.all([
        pool.query(`SELECT SUM(spending_limit) FROM envelopes;`),
        pool.query(`SELECT * FROM salary;`)
    ])
        .then(([envelopesResponse, salaryResponse]) => {
            const envelopesLimitsSum = sum || Number(envelopesResponse.rows[0].sum)
            const salaryAmount = req.body.amount || Number(salaryResponse.rows[0].amount)

            if (envelopesLimitsSum > salaryAmount) {
                let err = new Error(
                    `Bad request. The sum of all envelopes 'envelopes.spending_limit: ${envelopesLimitsSum}' cannot be higher than 'salary.amount: ${salaryAmount}'.`
                )
                err.code = 400
                err.public = true
                throw err
            }
        })
        .catch(error => { throw error })

    return results
}

// Salary
const createSalary = (req, res, next) => {
    const amount = req.body.amount

    pool.query(`
        INSERT INTO salary (amount)
        VALUEs ($1)
        RETURNING *;
    `, [amount], (error, results) => {
        if (error) {
            next(error)
        } else {
            res.status(201).json(results.rows[0])
        }
    })
}

const getSalary = (req, res, next) => {
    pool.query(`
        SELECT * FROM salary;    
    `, (error, results) => {
        if (error) {
            next(error)
        } else {
            res.status(200).json(results.rows[0])
        }
    })
}

const updateSalary = (req, res, next) => {
    const amount = req.body.amount

    pool.query(`
        UPDATE salary
        SET amount = $1
        RETURNING *;
    `, [amount], (error, results) => {
        if (error) {
            next(error)
        } else {
            res.status(200).json(results.rows[0])
        }
    })
}

// Envelopes
const getEnvelopes = (req, res, next) => {
    pool.query(`
        SELECT * FROM envelopes;
    `, (error, results) => {
        if (error) {
            next(error)
        } else {
            res.status(200).json(results.rows)
        }
    })
}

const createEnvelope = (req, res, next) => {
    const name = req.body.name
    const limit = req.body.spending_limit
    const available = req.body.spending_available

    pool.query(`
        INSERT INTO envelopes (name, spending_limit, spending_available)
        VALUES ($1, $2, $3)
        RETURNING *;
    `, [name, limit, available], (error, results) => {
        if (error) {
            next(error)
        } else {
            res.status(201).send(results.rows[0])
        }
    })
}

// Envelopes/id
const getEnvelopeById = (req, res, next) => {
    const id = req.params.id
    
    pool.query(`
        SELECT * FROM envelopes
        WHERE id = $1;
    `, [id], (error, response) => {
        if (error) {
            next(error)
        } else {
            res.status(200).json(response.rows[0])
        }
    })
}

const deleteEnvelopeById = async (req, res, next) => {
    const id = req.params.id

    await Promise.all([
        pool.query(`DELETE FROM expenses WHERE envelope_id = $1 RETURNING *;`, [id]),
        pool.query(`DELETE FROM envelopes WHERE id = $1 RETURNING *;`, [id])
    ])
        .then(([expensesResponse, envelopesResponse]) => {
            res.status(200).json({
                message: "Deleted the requested envelope and all associated expenses.",
                deletedEnvelope: envelopesResponse.rows[0],
                deletedExpenses: expensesResponse.rows
            })
        })
        .catch(error => next(error))
}

const updateEnvelopeById = (req, res, next) => {
    const name = req.body.name
    const limit = req.body.spending_limit
    const available = req.body.spending_available
    const id = req.params.id

    pool.query(`
        UPDAtE envelopes
        SET name = $1
        AND spending_limit = $2
        AND spending_available = $3
        WHERE id = $4
        RETURNING *;
    `, [name, limit, available, id], (error, results) => {
        if (error) {
            next(error)
        } else {
            res.status(200).json(results.rows[0])
        }
    })
}

// Expenses
const getExpenses = () => {}

const createExpense = () => {}

const deleteExpenseById = () => {}

module.exports = {
    doesIdExist,
    doesSalaryExist,
    doesEnvelopeExist,
    validateSumOfAllEnvelopesVsSalary,
    getSalary,
    updateSalary,
    createSalary,
    getEnvelopes,
    createEnvelope,
    getEnvelopeById,
    deleteEnvelopeById,
    updateEnvelopeById
}