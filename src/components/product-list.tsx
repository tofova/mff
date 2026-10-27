
'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import ProductCard from '@/components/product-card';
import type { Product, User, Order, UserProductControl } from '@/lib/definitions';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search } from 'lucide-react';
import { type ObjectId } from 'mongodb';
import { getProducts, getUserData, getOrdersForUser, getUserProductControls } from '@/app/actions';
import { useRefresh } from '@/context/RefreshContext';
import SecondCardWrapper from './second-card-wrapper';

interface ProductListProps {
    initialProducts: (Product & { _id: string | ObjectId })[];
    initialUser: User | null;
    initialOrders: Order[];
    initialControls: UserProductControl[];
}

export default function ProductList({ initialProducts, initialUser, initialOrders, initialControls }: ProductListProps) {
  const [products, setProducts] = useState(initialProducts);
  const [user, setUser] = useState(initialUser);
  const [orders, setOrders] = useState(initialOrders);
  const [controls, setControls] = useState(initialControls);

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const { refreshKey } = useRefresh();

  const fetchData = useCallback(async () => {
    try {
      const [
        updatedProducts,
        updatedUser,
      ] = await Promise.all([
        getProducts(),
        getUserData()
      ]);

      let updatedOrders: Order[] = [];
      let updatedControls: UserProductControl[] = [];
      
      if (updatedUser) {
          [updatedOrders, updatedControls] = await Promise.all([
              getOrdersForUser(),
              getUserProductControls(updatedUser.gamingId)
          ]);
      }

      setProducts(updatedProducts.map(p => ({...p, _id: p._id.toString()})));
      setUser(updatedUser);
      setOrders(updatedOrders);
      setControls(updatedControls);

    } catch (error) {
      console.error("Failed to poll for live data:", error);
    }
  }, []);

  useEffect(() => {
    const interval = setInterval(fetchData, 15000);
    return () => clearInterval(interval);
  }, [fetchData]);

  useEffect(() => {
    if (refreshKey > 0) {
      fetchData();
    }
  }, [refreshKey, fetchData]);

  const categories = useMemo(() => {
    const allCategories = new Set<string>();
    products.forEach(p => {
        if(Array.isArray(p.category)) {
            p.category.forEach(c => allCategories.add(c));
        } else if (p.category) {
            allCategories.add(p.category as unknown as string);
        }
    });
    return ['all', ...Array.from(allCategories)];
  }, [products]);

  const filteredAndSortedProducts = useMemo(() => {
    let currentProducts = [...products];
    
    if (user) {
        const hiddenProductIds = controls
            .filter(c => c.type === 'hideProduct' && c.gamingId === user.gamingId)
            .map(c => c.productId);
        
        currentProducts = currentProducts.filter(p => !hiddenProductIds.includes(p._id.toString()));
    }

    if (selectedCategory !== 'all') {
      currentProducts = currentProducts.filter(p => Array.isArray(p.category) && p.category.includes(selectedCategory));
    }

    if (searchTerm.trim() !== '') {
      const lowercasedSearchTerm = searchTerm.toLowerCase();
      currentProducts = currentProducts.filter(p => p.name.toLowerCase().includes(lowercasedSearchTerm));
      currentProducts.sort((a, b) => {
        const aName = a.name.toLowerCase();
        const bName = b.name.toLowerCase();
        const aStartsWith = aName.startsWith(lowercasedSearchTerm);
        const bStartsWith = bName.startsWith(lowercasedSearchTerm);
        
        if (aStartsWith && !bStartsWith) return -1;
        if (!aStartsWith && bStartsWith) return 1;

        return aName.localeCompare(bName);
      });
    }

    return currentProducts;
  }, [products, searchTerm, selectedCategory, user, controls]);

  return (
    <section className="ffi-clear w-full py-6 md:py-10 lg:py-12 bg-background">
      <div className="container mx-auto px-4 md:px-6">
        <h2 className="ffi-heading text-3xl md:text-4xl font-headline font-bold text-center mb-4 text-foreground">
          Purchase Item Now
        </h2>
        
        <div className="flex flex-row items-center justify-end gap-2 mb-8 md:mb-12">
            <div className="relative flex-grow max-w-[180px] sm:max-w-xs md:max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                <Input
                    type="text"
                    placeholder="Search products..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10 w-full"
                />
            </div>
            <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                <SelectTrigger className="w-[100px] md:w-[140px] flex-shrink-0">
                    <SelectValue placeholder="Select Category" />
                </SelectTrigger>
                <SelectContent>
                    {categories.map(category => (
                        <SelectItem key={category} value={category} className="capitalize">
                            {category === 'all' ? 'All Categories' : category}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 md:gap-8">
          {filteredAndSortedProducts.map((product, index) => {
            const productOrders = orders.filter(order => order.productId === product._id.toString());
            const control = user ? controls.find(c => c.productId === product._id.toString() && c.gamingId === user.gamingId) : undefined;

            return (
                <SecondCardWrapper key={product._id.toString()} index={index}>
                    <ProductCard
                      product={{...product, _id: product._id.toString()}}
                      user={user}
                      orders={productOrders}
                      control={control}
                    />
                </SecondCardWrapper>
            )
          })}
        </div>
      </div>
    </section>
  );
}
