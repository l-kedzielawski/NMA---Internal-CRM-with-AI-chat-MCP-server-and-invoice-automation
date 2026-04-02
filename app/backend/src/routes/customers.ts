import { Router } from 'express';
import { pool } from '../config/database';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import { requireRole } from '../middleware/auth';

const router = Router();

router.use(requireRole('admin', 'manager', 'bookkeeping'));

// GET /api/customers - List all customers
router.get('/', async (req, res) => {
  try {
    const { search } = req.query;
    
    let query = 'SELECT * FROM customers';
    const params: any[] = [];

    if (search) {
      query += ' WHERE nazwa LIKE ? OR nip LIKE ?';
      params.push(`%${search}%`, `%${search}%`);
    }

    query += ' ORDER BY nazwa ASC';

    const [rows] = await pool.query<RowDataPacket[]>(query, params);
    res.json(rows);
  } catch (error) {
    console.error('Error fetching customers:', error);
    res.status(500).json({ error: 'Failed to fetch customers' });
  }
});

// GET /api/customers/:id - Get single customer
router.get('/:id', async (req, res) => {
  try {
    const customerId = parseInt(req.params.id);
    
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT * FROM customers WHERE id = ?',
      [customerId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    res.json(rows[0]);
  } catch (error) {
    console.error('Error fetching customer:', error);
    res.status(500).json({ error: 'Failed to fetch customer' });
  }
});

// POST /api/customers - Create new customer
router.post('/', async (req, res) => {
  try {
    const {
      nazwa,
      nip,
      ulica,
      kod_pocztowy,
      miasto,
      kraj = 'Polska',
      email,
      telefon
    } = req.body;

    if (!nazwa) {
      return res.status(400).json({ error: 'Nazwa is required' });
    }

    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO customers (nazwa, nip, ulica, kod_pocztowy, miasto, kraj, email, telefon)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [nazwa, nip || null, ulica || null, kod_pocztowy || null, miasto || null, kraj, email || null, telefon || null]
    );

    res.status(201).json({
      id: result.insertId,
      message: 'Customer created successfully'
    });
  } catch (error) {
    console.error('Error creating customer:', error);
    res.status(500).json({ error: 'Failed to create customer' });
  }
});

// PUT /api/customers/:id - Update customer
router.put('/:id', async (req, res) => {
  try {
    const customerId = parseInt(req.params.id);
    const {
      nazwa,
      nip,
      ulica,
      kod_pocztowy,
      miasto,
      kraj,
      email,
      telefon
    } = req.body;

    const updates: string[] = [];
    const values: any[] = [];

    if (nazwa !== undefined) {
      updates.push('nazwa = ?');
      values.push(nazwa);
    }

    if (nip !== undefined) {
      updates.push('nip = ?');
      values.push(nip);
    }

    if (ulica !== undefined) {
      updates.push('ulica = ?');
      values.push(ulica);
    }

    if (kod_pocztowy !== undefined) {
      updates.push('kod_pocztowy = ?');
      values.push(kod_pocztowy);
    }

    if (miasto !== undefined) {
      updates.push('miasto = ?');
      values.push(miasto);
    }

    if (kraj !== undefined) {
      updates.push('kraj = ?');
      values.push(kraj);
    }

    if (email !== undefined) {
      updates.push('email = ?');
      values.push(email);
    }

    if (telefon !== undefined) {
      updates.push('telefon = ?');
      values.push(telefon);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(customerId);

    await pool.query(
      `UPDATE customers SET ${updates.join(', ')} WHERE id = ?`,
      values
    );

    res.json({ message: 'Customer updated successfully' });
  } catch (error) {
    console.error('Error updating customer:', error);
    res.status(500).json({ error: 'Failed to update customer' });
  }
});

// Find or create customer by NIP
router.post('/find-or-create', async (req, res) => {
  try {
    const { nazwa, nip, ulica, kod_pocztowy, miasto } = req.body;

    // Try to find by NIP first
    if (nip) {
      const [existing] = await pool.query<RowDataPacket[]>(
        'SELECT * FROM customers WHERE nip = ?',
        [nip]
      );

      if (existing.length > 0) {
        return res.json(existing[0]);
      }
    }

    // Try to find by name
    const [existingByName] = await pool.query<RowDataPacket[]>(
      'SELECT * FROM customers WHERE nazwa = ?',
      [nazwa]
    );

    if (existingByName.length > 0) {
      return res.json(existingByName[0]);
    }

    // Create new customer
    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO customers (nazwa, nip, ulica, kod_pocztowy, miasto)
       VALUES (?, ?, ?, ?, ?)`,
      [nazwa, nip || null, ulica || null, kod_pocztowy || null, miasto || null]
    );

    const [newCustomer] = await pool.query<RowDataPacket[]>(
      'SELECT * FROM customers WHERE id = ?',
      [result.insertId]
    );

    res.status(201).json(newCustomer[0]);
  } catch (error) {
    console.error('Error finding/creating customer:', error);
    res.status(500).json({ error: 'Failed to find or create customer' });
  }
});

export default router;
