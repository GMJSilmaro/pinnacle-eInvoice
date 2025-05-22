const express = require('express');
const router = express.Router();
const prisma = require('../../../src/lib/prisma');
const auth = require('../../../middleware/auth-prisma.middleware');

/**
 * @route GET /api/user/company/list
 * @desc Get list of all companies
 * @access Private (Admin only)
 */
router.get('/list', auth.isAdmin, async (req, res) => {
    try {
        // Fetch all companies
        const companies = await prisma.wP_COMPANY_SETTINGS.findMany({
            select: {
                ID: true,
                CompanyName: true,
                Industry: true,
                Country: true,
                TIN: true,
                BRN: true,
                Email: true,
                Phone: true,
                Address: true,
                ValidStatus: true
            },
            orderBy: {
                CompanyName: 'asc'
            }
        });

        // Format the response
        const formattedCompanies = companies.map(company => ({
            ID: company.ID,
            CompanyName: company.CompanyName || 'Unnamed Company',
            Industry: company.Industry || '',
            Country: company.Country || '',
            TIN: company.TIN || '',
            BRN: company.BRN || '',
            Email: company.Email || '',
            Phone: company.Phone || '',
            Address: company.Address || '',
            isActive: company.ValidStatus === '1' || company.ValidStatus === 1
        }));

        res.json(formattedCompanies);
    } catch (error) {
        console.error('Error fetching companies list:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch companies list'
        });
    }
});

module.exports = router;
